use crate::error::AppError;
use crate::known_hosts::{self, Verdict};
use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine as _;
use russh::client::{self, Handle};
use russh::keys::{Algorithm, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// `Mutex::lock` that recovers the guard from a poisoned lock. Every critical section here is a
/// single assignment/push/drain that leaves no half-updated invariant behind, so a panic elsewhere
/// must not permanently wedge the tunnel with `unwrap()` panics.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Frontend-supplied SSH tunnel config; secrets are plaintext on this wire (obfuscation only applies to the persisted registry copy).
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

/// Details of a rejected host key, stashed by `check_server_key` for `open()` to turn into a
/// user-facing `AppError` — `check_server_key`'s own return type (`russh::Error`) can't carry them.
#[derive(Debug, Clone)]
struct HostKeyMismatch {
    previous_key_type: String,
    previous_fingerprint: String,
    presented_key_type: String,
    presented_fingerprint: String,
}

/// TOFU host key check, OpenSSH `known_hosts`-style: the first key seen is trusted; a later mismatch rejects the handshake and fills `mismatch`.
struct ClientHandler {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
    mismatch: Arc<Mutex<Option<HostKeyMismatch>>>,
}

/// SHA-256 host key fingerprint as unpadded base64 (no `SHA256:` prefix) — the format russh 0.44
/// produced, kept so `known_hosts` entries saved by earlier versions still match.
fn host_key_fingerprint(key: &russh::keys::PublicKey) -> String {
    STANDARD_NO_PAD.encode(key.fingerprint(HashAlg::Sha256).as_bytes())
}

/// Key type label as russh 0.44 stored it: for RSA, the negotiated signature algorithm
/// (`rsa-sha2-512` / `rsa-sha2-256` / `ssh-rsa`); otherwise the key algorithm (`ssh-ed25519`, ...).
fn host_key_type(algorithm: Algorithm, hash_alg: Option<HashAlg>) -> String {
    match algorithm {
        Algorithm::Rsa { .. } => Algorithm::Rsa { hash: hash_alg }.as_str().to_string(),
        other => other.as_str().to_string(),
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let hash_alg = match server_key {
            PublicKeyOrCertificate::PublicKey { hash_alg, .. } => *hash_alg,
            PublicKeyOrCertificate::Certificate(_) => None,
        };
        let server_public_key = server_key.public_key();
        let key_type = host_key_type(server_public_key.algorithm(), hash_alg);
        let fingerprint = host_key_fingerprint(&server_public_key);

        // A corrupt/unreadable store must fail closed (reject), not silently fall back to trusting
        // everything — that would defeat the whole point of pinning.
        let Ok(list) = known_hosts::load(&self.known_hosts_path) else {
            *lock(&self.mismatch) = Some(HostKeyMismatch {
                previous_key_type: "?".into(),
                previous_fingerprint: "(could not read known_hosts store)".into(),
                presented_key_type: key_type,
                presented_fingerprint: fingerprint,
            });
            return Ok(false);
        };

        match known_hosts::verify(&list, &self.host, self.port, &key_type, &fingerprint) {
            Verdict::Match => Ok(true),
            Verdict::FirstUse => {
                let updated = known_hosts::upsert(list, &self.host, self.port, &key_type, &fingerprint);
                if let Err(e) = known_hosts::save(&self.known_hosts_path, &updated) {
                    eprintln!("ssh tunnel: failed to persist trusted host key for {}:{}: {e}", self.host, self.port);
                }
                Ok(true)
            }
            Verdict::Mismatch { previous_key_type, previous_fingerprint } => {
                *lock(&self.mismatch) = Some(HostKeyMismatch {
                    previous_key_type,
                    previous_fingerprint,
                    presented_key_type: key_type,
                    presented_fingerprint: fingerprint,
                });
                Ok(false)
            }
        }
    }
}

/// Owns the accept-loop task plus every in-flight forward task; dropping it aborts all of them immediately.
#[derive(Debug)]
pub struct SshTunnelHandle {
    pub local_port: u16,
    task: JoinHandle<()>,
    forwards: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Drop for SshTunnelHandle {
    fn drop(&mut self) {
        self.task.abort();
        for handle in lock(&self.forwards).drain(..) {
            handle.abort();
        }
    }
}

pub async fn open(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
    known_hosts_path: &Path,
) -> Result<SshTunnelHandle, AppError> {
    let config = Arc::new(client::Config::default());
    let mismatch: Arc<Mutex<Option<HostKeyMismatch>>> = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        host: cfg.host.clone(),
        port: cfg.port,
        known_hosts_path: known_hosts_path.to_path_buf(),
        mismatch: mismatch.clone(),
    };
    let mut session = client::connect(config, (cfg.host.as_str(), cfg.port), handler)
        .await
        .map_err(|e| match lock(&mismatch).take() {
            Some(m) => AppError::SshTunnel(format!(
                "SSH host key for {}:{} does not match the previously trusted key (expected {} fingerprint {}, got {} fingerprint {}). This could mean the server was reinstalled, or that the connection is being intercepted. If you trust this host, use \"Forget host key\" in the connection settings and reconnect.",
                cfg.host, cfg.port, m.previous_key_type, m.previous_fingerprint, m.presented_key_type, m.presented_fingerprint
            )),
            None => AppError::SshTunnel(e.to_string()),
        })?;

    let authenticated = match cfg.auth_method.as_str() {
        "key" => {
            let key_pair = russh::keys::load_secret_key(
                &cfg.private_key_path,
                if cfg.passphrase.is_empty() {
                    None
                } else {
                    Some(cfg.passphrase.as_str())
                },
            )
            .map_err(|e| AppError::SshTunnel(format!("failed to load private key: {e}")))?;
            // RSA keys sign with the strongest hash the server advertises (rsa-sha2-512/256); ignored for other key types.
            let rsa_hash = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| AppError::SshTunnel(e.to_string()))?
                .flatten();
            session
                .authenticate_publickey(&cfg.user, PrivateKeyWithHashAlg::new(Arc::new(key_pair), rsa_hash))
                .await
                .map_err(|e| AppError::SshTunnel(e.to_string()))?
                .success()
        }
        "password" => session
            .authenticate_password(&cfg.user, &cfg.password)
            .await
            .map_err(|e| AppError::SshTunnel(e.to_string()))?
            .success(),
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
            let mut guard = lock(&forwards_for_loop);
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
    use russh::keys::ssh_key::private::Ed25519Keypair;
    use russh::keys::PrivateKey;
    use russh::server::{self, Auth, ChannelOpenHandle, Msg, Server as _, Session};
    use russh::Channel;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A minimal mock SSH server: accepts a fixed username/password, and relays `direct-tcpip` opens to the test's local echo listener.
    struct MockHandler;

    impl server::Server for MockHandler {
        type Handler = Self;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
            MockHandler
        }
    }

    impl server::Handler for MockHandler {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(if user == "tester" && password == "testpass" {
                Auth::Accept
            } else {
                Auth::reject()
            })
        }

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _key: &russh::keys::PublicKey,
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
            reply: ChannelOpenHandle,
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            let addr = format!("{host_to_connect}:{port_to_connect}");
            let mut remote = tokio::net::TcpStream::connect(addr).await?;
            reply.accept().await;
            tokio::spawn(async move {
                let mut chan = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut chan, &mut remote).await;
            });
            Ok(())
        }
    }

    /// Spins up the mock SSH server presenting `key`, optionally on a fixed `port`; returns the bound port and the accept loop's abortable handle.
    /// Deterministic ed25519 key from a one-byte seed — distinct seeds give distinct keys, no RNG needed.
    fn ed25519_key(seed: u8) -> PrivateKey {
        PrivateKey::from(Ed25519Keypair::from_seed(&[seed; 32]))
    }

    async fn spawn_mock_ssh_server_with_key(port: Option<u16>, key: PrivateKey) -> (u16, tokio::task::JoinHandle<()>) {
        let config = Arc::new(server::Config {
            keys: vec![key],
            ..Default::default()
        });
        let listener = TcpListener::bind(("127.0.0.1", port.unwrap_or(0))).await.unwrap();
        let bound_port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
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
        (bound_port, handle)
    }

    /// Spins up the mock SSH server on 127.0.0.1:0 with a fresh random key; returns its port.
    async fn spawn_mock_ssh_server() -> u16 {
        spawn_mock_ssh_server_with_key(None, ed25519_key(1)).await.0
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

    /// Fresh, non-colliding `known_hosts.json` path for a test — cleared up front so a leftover
    /// file from a previous run can't leak a stale trust entry into this one.
    fn temp_known_hosts_path(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("monglumio_test_known_hosts_{name}.json"));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[tokio::test]
    async fn correct_password_opens_tunnel_and_relays_bytes() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let known_hosts_path = temp_known_hosts_path("correct_password");
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
        let tunnel = open(&cfg, "127.0.0.1", echo_port, &known_hosts_path).await.unwrap();

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
        let key = ed25519_key(10);
        let mut pem = Vec::new();
        russh::keys::encode_pkcs8_pem(&key, &mut pem).unwrap();
        let key_path = std::env::temp_dir().join("monglumio_test_ssh_key_ok.pem");
        std::fs::write(&key_path, &pem).unwrap();
        let known_hosts_path = temp_known_hosts_path("correct_private_key");

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
        let tunnel = open(&cfg, "127.0.0.1", echo_port, &known_hosts_path).await.unwrap();

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
        let key = ed25519_key(11);
        let mut pem = Vec::new();
        russh::keys::encode_pkcs8_pem_encrypted(&key, b"correct-passphrase", 4, &mut pem).unwrap();
        let key_path = std::env::temp_dir().join("monglumio_test_ssh_key_encrypted.pem");
        std::fs::write(&key_path, &pem).unwrap();
        let known_hosts_path = temp_known_hosts_path("wrong_passphrase");

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
        let err = open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));

        let _ = std::fs::remove_file(&key_path);
    }

    #[tokio::test]
    async fn wrong_password_fails_with_ssh_tunnel_error() {
        let ssh_port = spawn_mock_ssh_server().await;
        let known_hosts_path = temp_known_hosts_path("wrong_password");
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
        let err = open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));
    }

    #[tokio::test]
    async fn unknown_auth_method_fails_instead_of_silently_trying_password() {
        let ssh_port = spawn_mock_ssh_server().await;
        let known_hosts_path = temp_known_hosts_path("unknown_auth_method");
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
        let err = open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap_err();
        match err {
            AppError::SshTunnel(msg) => assert!(msg.contains("auth_method"), "got: {msg}"),
            other => panic!("expected AppError::SshTunnel, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unreachable_ssh_host_fails_with_ssh_tunnel_error() {
        let known_hosts_path = temp_known_hosts_path("unreachable_host");
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
        let err = open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap_err();
        assert!(matches!(err, AppError::SshTunnel(_)));
    }

    #[tokio::test]
    async fn forwards_vec_reaps_finished_handles_instead_of_growing_unbounded() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let known_hosts_path = temp_known_hosts_path("forwards_reap");
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
        let tunnel = open(&cfg, "127.0.0.1", echo_port, &known_hosts_path).await.unwrap();

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

        let n = lock(&tunnel.forwards).len();
        assert!(n <= 1, "expected finished forward handles to be reaped, got {n} entries");
    }

    #[tokio::test]
    async fn drop_aborts_in_flight_forward_tasks_not_just_the_accept_loop() {
        let ssh_port = spawn_mock_ssh_server().await;
        let echo_port = spawn_echo_server().await;
        let known_hosts_path = temp_known_hosts_path("drop_aborts");
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
        let tunnel = open(&cfg, "127.0.0.1", echo_port, &known_hosts_path).await.unwrap();

        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        conn.read_exact(&mut buf).await.unwrap();

        drop(tunnel);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // The forward task's abort drops the local socket too; a read should see EOF/reset quickly, not hang.
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

    #[test]
    fn host_key_fingerprint_keeps_the_pre_upgrade_format() {
        // Expected value computed independently: unpadded base64 of SHA-256 over the key's SSH wire
        // encoding (what russh 0.44 stored). A format change would turn every saved host into a "mismatch".
        let key = ed25519_key(1);
        assert_eq!(host_key_fingerprint(key.public_key()), "fe85JkIjo8VPe+XqXJGH5Mau1EMFdK1OdKvJUFicyA8");
    }

    #[test]
    fn host_key_type_keeps_the_pre_upgrade_names() {
        assert_eq!(host_key_type(Algorithm::Ed25519, None), "ssh-ed25519");
        assert_eq!(host_key_type(Algorithm::Rsa { hash: None }, Some(HashAlg::Sha512)), "rsa-sha2-512");
        assert_eq!(host_key_type(Algorithm::Rsa { hash: None }, Some(HashAlg::Sha256)), "rsa-sha2-256");
        assert_eq!(host_key_type(Algorithm::Rsa { hash: None }, None), "ssh-rsa");
    }

    #[tokio::test]
    async fn first_connect_trusts_and_persists_the_host_key() {
        let ssh_port = spawn_mock_ssh_server().await;
        let known_hosts_path = temp_known_hosts_path("first_use");
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
        open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap();

        let stored = known_hosts::load(&known_hosts_path).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].host, "127.0.0.1");
        assert_eq!(stored[0].port, ssh_port);
        assert_eq!(stored[0].key_type, "ssh-ed25519");
    }

    #[tokio::test]
    async fn reconnecting_with_the_same_key_succeeds_and_does_not_duplicate_the_entry() {
        let ssh_port = spawn_mock_ssh_server().await;
        let known_hosts_path = temp_known_hosts_path("match");
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
        open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap(); // first use
        open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap(); // match

        let stored = known_hosts::load(&known_hosts_path).unwrap();
        assert_eq!(stored.len(), 1);
    }

    #[tokio::test]
    async fn host_key_change_is_rejected_until_the_stale_entry_is_forgotten() {
        let known_hosts_path = temp_known_hosts_path("mismatch_then_forget");
        let (ssh_port, server_a) =
            spawn_mock_ssh_server_with_key(None, ed25519_key(2)).await;
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
        open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap(); // trusts server A's key

        // Swap the server behind the same host:port for one presenting a different key —
        // simulates either a legitimate reinstall or a MITM.
        server_a.abort();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let (_, server_b) =
            spawn_mock_ssh_server_with_key(Some(ssh_port), ed25519_key(3)).await;

        let err = open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap_err();
        match err {
            AppError::SshTunnel(msg) => {
                assert!(msg.contains("does not match"), "got: {msg}");
                assert!(msg.contains("Forget host key"), "got: {msg}");
            }
            other => panic!("expected AppError::SshTunnel, got {other:?}"),
        }

        // Forgetting the stale entry lets the new key be trusted as first use.
        let list = known_hosts::forget(known_hosts::load(&known_hosts_path).unwrap(), "127.0.0.1", ssh_port);
        known_hosts::save(&known_hosts_path, &list).unwrap();

        open(&cfg, "127.0.0.1", 1, &known_hosts_path).await.unwrap();
        let stored = known_hosts::load(&known_hosts_path).unwrap();
        assert_eq!(stored.len(), 1);

        server_b.abort();
    }
}
