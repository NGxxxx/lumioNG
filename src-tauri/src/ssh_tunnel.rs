use crate::error::AppError;
use async_trait::async_trait;
use russh::client::{self, Handle};
use russh_keys::key::PublicKey;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// Frontend-supplied SSH tunnel config for `connect`/`test_connection`. Secrets are plaintext on
/// this wire (same convention as the Mongo password embedded in `uri`) — obfuscation only applies
/// to the persisted registry copy (`ConnectionInput`/`SavedConnection`), which Rust never touches.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: String, // "password" | "key"
    pub password: String,
    pub private_key_path: String,
    pub passphrase: String,
}

struct ClientHandler;

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    // TODO(security): accepts any host key — no MITM protection. A rogue/spoofed SSH server on
    // the network path would see plaintext SSH creds (password auth) and all tunneled Mongo
    // traffic. Deliberately deferred at v1 (no host-key pinning UI); fix is OpenSSH-style TOFU —
    // store each host's key fingerprint on first connect (in the registry, alongside the SSH
    // fields), compare on every subsequent connect, and surface a clear warning/blocking dialog
    // if it ever changes. Needs its own brainstorm (where to store, UX for first-trust + changed-
    // key prompts) before implementing.
    async fn check_server_key(&mut self, _server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Owns the local listener's accept-loop task plus every in-flight per-connection forward task;
/// dropping it aborts all of them, closing the tunnel immediately rather than waiting for each
/// forwarded socket to notice on its own.
#[derive(Debug)]
pub struct SshTunnelHandle {
    pub local_port: u16,
    task: JoinHandle<()>,
    forwards: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Drop for SshTunnelHandle {
    fn drop(&mut self) {
        self.task.abort();
        for handle in self.forwards.lock().unwrap().drain(..) {
            handle.abort();
        }
    }
}

pub async fn open(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
) -> Result<SshTunnelHandle, AppError> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (cfg.host.as_str(), cfg.port), ClientHandler)
        .await
        .map_err(|e| AppError::SshTunnel(e.to_string()))?;

    let authenticated = match cfg.auth_method.as_str() {
        "key" => {
            let key_pair = russh_keys::load_secret_key(
                &cfg.private_key_path,
                if cfg.passphrase.is_empty() {
                    None
                } else {
                    Some(cfg.passphrase.as_str())
                },
            )
            .map_err(|e| AppError::SshTunnel(format!("failed to load private key: {e}")))?;
            session
                .authenticate_publickey(&cfg.user, Arc::new(key_pair))
                .await
                .map_err(|e| AppError::SshTunnel(e.to_string()))?
        }
        "password" => session
            .authenticate_password(&cfg.user, &cfg.password)
            .await
            .map_err(|e| AppError::SshTunnel(e.to_string()))?,
        other => {
            return Err(AppError::SshTunnel(format!(
                "unknown SSH auth_method \"{other}\" (expected \"password\" or \"key\")"
            )));
        }
    };
    if !authenticated {
        return Err(AppError::SshTunnel("SSH authentication rejected".into()));
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::SshTunnel(format!("failed to bind local port: {e}")))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::SshTunnel(e.to_string()))?
        .port();

    let session = Arc::new(session);
    let remote_host = remote_host.to_string();
    let forwards: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
    let forwards_for_loop = forwards.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((local_stream, _)) = listener.accept().await else {
                break;
            };
            let session = session.clone();
            let remote_host = remote_host.clone();
            let handle = tokio::spawn(async move {
                if let Err(e) = forward_one(session, local_stream, &remote_host, remote_port).await {
                    eprintln!("ssh tunnel: forward to {remote_host}:{remote_port} failed: {e}");
                }
            });
            let mut guard = forwards_for_loop.lock().unwrap();
            guard.retain(|h| !h.is_finished());
            guard.push(handle);
        }
    });

    Ok(SshTunnelHandle { local_port, task, forwards })
}

/// Mongo's driver opens a connection pool, not one socket — every accepted local connection gets
/// its own `direct-tcpip` channel, forwarded independently.
async fn forward_one(
    session: Arc<Handle<ClientHandler>>,
    mut local: TcpStream,
    remote_host: &str,
    remote_port: u16,
) -> Result<(), russh::Error> {
    let channel = session
        .channel_open_direct_tcpip(remote_host, remote_port as u32, "127.0.0.1", 0)
        .await?;
    let mut ssh_stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut local, &mut ssh_stream).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use russh::server::{self, Auth, Msg, Server as _, Session};
    use russh::Channel;
    use russh_keys::key::KeyPair;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A minimal mock SSH server: accepts a fixed username/password (and any publickey), and on
    /// `direct-tcpip` open connects to the local TCP echo listener the test spun up, relaying bytes
    /// both ways via `copy_bidirectional` over the server-side channel stream.
    struct MockHandler;

    impl server::Server for MockHandler {
        type Handler = Self;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
            MockHandler
        }
    }

    #[async_trait]
    impl server::Handler for MockHandler {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(if user == "tester" && password == "testpass" {
                Auth::Accept
            } else {
                Auth::Reject { proceed_with_methods: None }
            })
        }

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _key: &russh_keys::key::PublicKey,
        ) -> Result<Auth, Self::Error> {
            Ok(Auth::Accept)
        }

        async fn channel_open_direct_tcpip(
            &mut self,
            channel: Channel<Msg>,
            host_to_connect: &str,
            port_to_connect: u32,
            _originator_address: &str,
            _originator_port: u32,
            _session: &mut Session,
        ) -> Result<bool, Self::Error> {
            let addr = format!("{host_to_connect}:{port_to_connect}");
            let mut remote = tokio::net::TcpStream::connect(addr).await?;
            tokio::spawn(async move {
                let mut chan = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut chan, &mut remote).await;
            });
            Ok(true)
        }
    }

    /// Spins up the mock SSH server on 127.0.0.1:0; returns its port.
    async fn spawn_mock_ssh_server() -> u16 {
        let key = KeyPair::generate_ed25519().unwrap();
        let config = Arc::new(server::Config {
            keys: vec![key],
            ..Default::default()
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut server = MockHandler;
            loop {
                let Ok((stream, addr)) = listener.accept().await else {
                    break;
                };
                let config = config.clone();
                let handler = server.new_client(Some(addr));
                tokio::spawn(async move {
                    let _ = server::run_stream(config, stream, handler).await;
                });
            }
        });
        port
    }

    /// A local TCP echo listener standing in for "the remote Mongo host"; returns its port.
    async fn spawn_echo_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    loop {
                        match stream.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if stream.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });
        port
    }

    #[tokio::test]
    async fn correct_password_opens_tunnel_and_relays_bytes() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "testpass".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let tunnel = open(&cfg, "127.0.0.1", echo_port).await.unwrap();

        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        conn.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello");
    }

    #[tokio::test]
    async fn correct_private_key_opens_tunnel_and_relays_bytes() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;

        // Generate an ed25519 key and write it as an unencrypted OpenSSH-readable PKCS#8 PEM
        // (`-----BEGIN PRIVATE KEY-----`), the format `load_secret_key` parses back.
        let key = KeyPair::generate_ed25519().unwrap();
        let mut pem = Vec::new();
        russh_keys::encode_pkcs8_pem(&key, &mut pem).unwrap();
        let key_path = std::env::temp_dir().join("monglumio_test_ssh_key_ok.pem");
        std::fs::write(&key_path, &pem).unwrap();

        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "key".into(),
            password: String::new(),
            private_key_path: key_path.to_string_lossy().into_owned(),
            passphrase: String::new(),
        };
        let tunnel = open(&cfg, "127.0.0.1", echo_port).await.unwrap();

        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        conn.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello");

        let _ = std::fs::remove_file(&key_path);
    }

    #[tokio::test]
    async fn wrong_passphrase_on_encrypted_key_fails_with_ssh_tunnel_error() {
        let ssh_port = spawn_mock_ssh_server().await;

        // Encrypt the key with one passphrase, then attempt to load it with a different one:
        // `load_secret_key` must fail (exercising the non-empty-passphrase `Some(..)` branch).
        let key = KeyPair::generate_ed25519().unwrap();
        let mut pem = Vec::new();
        russh_keys::encode_pkcs8_pem_encrypted(&key, b"correct-passphrase", 4, &mut pem).unwrap();
        let key_path = std::env::temp_dir().join("monglumio_test_ssh_key_encrypted.pem");
        std::fs::write(&key_path, &pem).unwrap();

        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "key".into(),
            password: String::new(),
            private_key_path: key_path.to_string_lossy().into_owned(),
            passphrase: "wrong-passphrase".into(),
        };
        let err = open(&cfg, "127.0.0.1", 1).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));

        let _ = std::fs::remove_file(&key_path);
    }

    #[tokio::test]
    async fn wrong_password_fails_with_ssh_tunnel_error() {
        let ssh_port = spawn_mock_ssh_server().await;
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "wrong".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let err = open(&cfg, "127.0.0.1", 1).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));
    }

    #[tokio::test]
    async fn unknown_auth_method_fails_instead_of_silently_trying_password() {
        let ssh_port = spawn_mock_ssh_server().await;
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "bogus".into(),
            password: "testpass".into(), // would succeed against the mock server if silently tried
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let err = open(&cfg, "127.0.0.1", 1).await.unwrap_err();
        match err {
            AppError::SshTunnel(msg) => assert!(msg.contains("auth_method"), "got: {msg}"),
            other => panic!("expected AppError::SshTunnel, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unreachable_ssh_host_fails_with_ssh_tunnel_error() {
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: 1,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "x".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let err = open(&cfg, "127.0.0.1", 1).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));
    }

    #[tokio::test]
    async fn forwards_vec_reaps_finished_handles_instead_of_growing_unbounded() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "testpass".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let tunnel = open(&cfg, "127.0.0.1", echo_port).await.unwrap();

        // Open and fully close 5 short-lived connections through the tunnel; each spawns and then
        // finishes its own forward task well before the next one starts.
        for _ in 0..5 {
            let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
                .await
                .unwrap();
            conn.write_all(b"x").await.unwrap();
            let mut buf = [0u8; 1];
            conn.read_exact(&mut buf).await.unwrap();
            drop(conn);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // One more connection triggers the accept loop's next push, which should reap the 5
        // already-finished handles instead of letting the vec grow forever.
        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"x").await.unwrap();
        let mut buf = [0u8; 1];
        conn.read_exact(&mut buf).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let n = tunnel.forwards.lock().unwrap().len();
        assert!(n <= 1, "expected finished forward handles to be reaped, got {n} entries");
    }

    #[tokio::test]
    async fn drop_aborts_in_flight_forward_tasks_not_just_the_accept_loop() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let cfg = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "testpass".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        };
        let tunnel = open(&cfg, "127.0.0.1", echo_port).await.unwrap();

        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        conn.read_exact(&mut buf).await.unwrap();

        drop(tunnel);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // With the forward task aborted, the local half of this already-established connection
        // is dropped too, closing the socket. A read should observe that quickly (EOF or a reset
        // error) instead of hanging forever waiting on a still-alive relay.
        let mut probe = [0u8; 1];
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            conn.read(&mut probe),
        )
        .await;
        match result {
            Ok(Ok(0)) => {}  // EOF — the forward task was aborted, socket closed.
            Ok(Err(_)) => {} // connection reset — also evidence of closure.
            other => panic!("expected the connection to close after dropping the tunnel, got {other:?}"),
        }
    }
}
