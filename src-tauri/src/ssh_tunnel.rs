use crate::error::AppError;
use crate::known_hosts::{self, Verdict};
use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine as _;
use russh::client::{self, Handle};
use russh::keys::{Algorithm, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

// Every critical section on the std mutexes here is a single assignment/push/drain, so a poisoned
// lock is safe to recover.
use crate::util::lock_recover as lock;

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
    shared: Arc<Shared>,
}

impl SshTunnelHandle {
    /// True while the SSH session is closed (dropped and not re-established yet).
    pub fn is_down(&self) -> bool {
        lock(&self.shared.snap).session.is_closed()
    }

    /// `host:port` of the SSH server (no credentials).
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.shared.cfg.host, self.shared.cfg.port)
    }

    /// How many full reopen cycles (all backoff attempts) have been run.
    #[cfg(test)]
    fn reopen_cycles(&self) -> usize {
        self.shared.cycles.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl Drop for SshTunnelHandle {
    fn drop(&mut self) {
        self.task.abort();
        for handle in lock(&self.forwards).drain(..) {
            handle.abort();
        }
    }
}

/// How long to wait before each of the (at most three) attempts to re-establish a dropped SSH session.
pub const REOPEN_BACKOFF: [Duration; 3] = [Duration::from_secs(1), Duration::from_secs(2), Duration::from_secs(4)];

/// Upper bound for connecting + authenticating an SSH session, and for opening one forwarding channel.
pub const SSH_IO_TIMEOUT: Duration = Duration::from_secs(10);
/// After a reopen cycle fails, new connections fail immediately for this long instead of retrying.
const REOPEN_FAIL_WINDOW: Duration = Duration::from_secs(5);

type SshSession = Handle<ClientHandler>;

/// Connects and authenticates one SSH session (no forwarding yet), within `timeout`.
async fn connect_session(cfg: &SshTunnelConfig, known_hosts_path: &Path, timeout: Duration) -> Result<SshSession, AppError> {
    tokio::time::timeout(timeout, connect_session_inner(cfg, known_hosts_path))
        .await
        .map_err(|_| AppError::SshTunnel(format!("timed out connecting to {}:{}", cfg.host, cfg.port)))?
}

async fn connect_session_inner(cfg: &SshTunnelConfig, known_hosts_path: &Path) -> Result<SshSession, AppError> {
    // Keepalives detect a half-open session (NAT timeout, cable pulled) that never reports a close.
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        ..Default::default()
    });
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

    Ok(session)
}

pub async fn open(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
    known_hosts_path: &Path,
) -> Result<SshTunnelHandle, AppError> {
    open_with_backoff(cfg, remote_host, remote_port, known_hosts_path, REOPEN_BACKOFF.to_vec()).await
}

pub async fn open_with_backoff(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
    known_hosts_path: &Path,
    backoff: Vec<Duration>,
) -> Result<SshTunnelHandle, AppError> {
    open_with_timeouts(cfg, remote_host, remote_port, known_hosts_path, backoff, SSH_IO_TIMEOUT).await
}

/// `open` with an explicit reopen schedule: when the SSH session drops, the tunnel re-establishes it
/// (one attempt per entry, sleeping that long first) on the same `local_port`, so the driver's
/// pooled connections just reconnect to the address they already know.
async fn open_with_timeouts(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
    known_hosts_path: &Path,
    backoff: Vec<Duration>,
    io_timeout: Duration,
) -> Result<SshTunnelHandle, AppError> {
    let session = connect_session(cfg, known_hosts_path, io_timeout).await?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::SshTunnel(format!("failed to bind local port: {e}")))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::SshTunnel(e.to_string()))?
        .port();

    let shared = Arc::new(Shared {
        snap: Mutex::new(Snapshot { session: Arc::new(session), failed_at: None }),
        reopen_lock: tokio::sync::Mutex::new(()),
        cycles: std::sync::atomic::AtomicUsize::new(0),
        cfg: cfg.clone(),
        known_hosts_path: known_hosts_path.to_path_buf(),
        backoff,
        io_timeout,
        fail_window: REOPEN_FAIL_WINDOW,
    });
    let handle_shared = shared.clone();
    let remote_host = remote_host.to_string();
    let forwards: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
    let forwards_for_loop = forwards.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((local_stream, _)) = listener.accept().await else {
                break;
            };
            let shared = shared.clone();
            let remote_host = remote_host.clone();
            let handle = tokio::spawn(async move {
                if let Err(e) = forward_one(shared, local_stream, &remote_host, remote_port).await {
                    tracing::warn!("ssh tunnel: forward to {remote_host}:{remote_port} failed: {e}");
                }
            });
            let mut guard = lock(&forwards_for_loop);
            guard.retain(|h| !h.is_finished());
            guard.push(handle);
        }
    });

    Ok(SshTunnelHandle { local_port, task, forwards, shared: handle_shared })
}

/// The current SSH session. Guarded by a plain mutex that is only ever held for a clone or an
/// assignment - never across a sleep or I/O - so reading it never waits for a reopen.
struct Snapshot {
    session: Arc<SshSession>,
    /// When the last reopen cycle failed completely.
    failed_at: Option<Instant>,
}

/// Everything needed to re-establish the SSH session after it drops.
struct Shared {
    snap: Mutex<Snapshot>,
    /// Held by whoever is running a reopen cycle; other connections queue on it and then reuse its outcome.
    reopen_lock: tokio::sync::Mutex<()>,
    cycles: std::sync::atomic::AtomicUsize,
    cfg: SshTunnelConfig,
    known_hosts_path: PathBuf,
    backoff: Vec<Duration>,
    io_timeout: Duration,
    fail_window: Duration,
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Shared").field("host", &self.cfg.host).field("port", &self.cfg.port).finish()
    }
}

impl Shared {
    fn current(&self) -> Arc<SshSession> {
        lock(&self.snap).session.clone()
    }

    /// `Some(err)` while the last reopen cycle failed less than `fail_window` ago for this `stale` session.
    fn recent_failure(&self, stale: &Arc<SshSession>) -> Option<AppError> {
        let g = lock(&self.snap);
        let recent = g.failed_at.is_some_and(|t| t.elapsed() < self.fail_window);
        (recent && Arc::ptr_eq(&g.session, stale) && g.session.is_closed()).then(|| self.down_error())
    }

    fn down_error(&self) -> AppError {
        AppError::SshTunnel(format!("SSH tunnel to {}:{} is down; reconnecting failed", self.cfg.host, self.cfg.port))
    }

    /// Replaces the dropped `stale` session. One cycle runs at a time; connections that arrive
    /// meanwhile wait for it and share its outcome, and for a few seconds after a failed cycle
    /// new arrivals fail at once rather than start another.
    async fn reopen(&self, stale: &Arc<SshSession>) -> Result<Arc<SshSession>, AppError> {
        if let Some(e) = self.recent_failure(stale) {
            return Err(e);
        }
        let _cycle = self.reopen_lock.lock().await;
        {
            let g = lock(&self.snap);
            if !Arc::ptr_eq(&g.session, stale) || !g.session.is_closed() {
                return Ok(g.session.clone()); // somebody else already reopened it
            }
        }
        if let Some(e) = self.recent_failure(stale) {
            return Err(e); // the cycle we queued behind failed
        }
        self.cycles.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut last = AppError::SshTunnel("SSH session closed".into());
        for (attempt, delay) in self.backoff.iter().enumerate() {
            tokio::time::sleep(*delay).await;
            match connect_session(&self.cfg, &self.known_hosts_path, self.io_timeout).await {
                Ok(fresh) => {
                    tracing::info!("ssh tunnel: re-established after {} attempt(s)", attempt + 1);
                    let fresh = Arc::new(fresh);
                    let mut g = lock(&self.snap);
                    g.session = fresh.clone();
                    g.failed_at = None;
                    return Ok(fresh);
                }
                Err(e) => {
                    tracing::warn!("ssh tunnel: reopen attempt {} failed: {e}", attempt + 1);
                    last = e;
                }
            }
        }
        lock(&self.snap).failed_at = Some(Instant::now());
        let _ = last; // the specific cause is in the log; callers get the stable "is down" message
        Err(self.down_error())
    }

    async fn open_on(&self, session: &SshSession, remote_host: &str, remote_port: u16) -> Result<russh::Channel<client::Msg>, AppError> {
        match tokio::time::timeout(
            self.io_timeout,
            session.channel_open_direct_tcpip(remote_host, remote_port as u32, "127.0.0.1", 0),
        )
        .await
        {
            Ok(Ok(c)) => Ok(c),
            Ok(Err(e)) => Err(AppError::SshTunnel(e.to_string())),
            Err(_) => Err(AppError::SshTunnel("timed out opening an SSH channel".into())),
        }
    }

    /// Opens a `direct-tcpip` channel, re-establishing the SSH session first when it has dropped.
    async fn open_channel(&self, remote_host: &str, remote_port: u16) -> Result<russh::Channel<client::Msg>, AppError> {
        let session = self.current();
        if !session.is_closed() {
            match self.open_on(&session, remote_host, remote_port).await {
                Ok(c) => return Ok(c),
                // The target refused the forward (or it timed out) but the SSH session is fine: not a reopen case.
                Err(e) if !session.is_closed() => return Err(e),
                Err(_) => {}
            }
        }
        let fresh = self.reopen(&session).await?;
        self.open_on(&fresh, remote_host, remote_port).await
    }
}

/// Mongo's driver opens a connection pool, not one socket — every accepted local connection gets
/// its own `direct-tcpip` channel, forwarded independently.
async fn forward_one(
    shared: Arc<Shared>,
    mut local: TcpStream,
    remote_host: &str,
    remote_port: u16,
) -> Result<(), AppError> {
    let channel = shared.open_channel(remote_host, remote_port).await?;
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
        let path = std::env::temp_dir().join(format!("lumiong_test_known_hosts_{name}.json"));
        let _ = std::fs::remove_file(&path);
        path
    }

    /// Like `spawn_mock_ssh_server_with_key`, but also hands back every accepted client's task so a
    /// test can drop all live SSH sessions at once (a channel dropping abnormally) while the server keeps listening.
    async fn spawn_killable_ssh_server(key: PrivateKey) -> (u16, Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>, tokio::task::JoinHandle<()>) {
        let config = Arc::new(server::Config { keys: vec![key], ..Default::default() });
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let clients: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
        let clients_for_loop = clients.clone();
        let accept = tokio::spawn(async move {
            let mut server = MockHandler;
            loop {
                let Ok((stream, addr)) = listener.accept().await else { break };
                let config = config.clone();
                let handler = server.new_client(Some(addr));
                // The SSH server talks to an in-memory pipe that a relay task bridges to the socket:
                // aborting the relay closes the socket (the client sees the session die) and the pipe (the server session ends).
                let (server_end, relay_end) = tokio::io::duplex(64 * 1024);
                tokio::spawn(async move {
                    let _ = server::run_stream(config, server_end, handler).await;
                });
                let relay = tokio::spawn(async move {
                    let (mut stream, mut relay_end) = (stream, relay_end);
                    let _ = tokio::io::copy_bidirectional(&mut stream, &mut relay_end).await;
                });
                lock(&clients_for_loop).push(relay);
            }
        });
        (port, clients, accept)
    }

    /// Polls `cond` every 10 ms until it holds; panics after a generous 10 s.
    async fn wait_until(mut cond: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !cond() {
            assert!(std::time::Instant::now() < deadline, "condition not reached in time");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    fn password_cfg(ssh_port: u16) -> SshTunnelConfig {
        SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: "password".into(),
            password: "testpass".into(),
            private_key_path: String::new(),
            passphrase: String::new(),
        }
    }

    async fn echo_roundtrip(port: u16, msg: &[u8]) -> std::io::Result<Vec<u8>> {
        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
        conn.write_all(msg).await?;
        let mut buf = vec![0u8; msg.len()];
        tokio::time::timeout(Duration::from_secs(5), conn.read_exact(&mut buf))
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "no echo"))??;
        Ok(buf)
    }

    #[tokio::test]
    async fn reopens_after_channel_drop() {
        let (ssh_port, clients, _accept) = spawn_killable_ssh_server(ed25519_key(2)).await;
        let echo_port = spawn_echo_server().await;
        let kh = temp_known_hosts_path("reopen_after_drop");
        let backoff = vec![Duration::from_millis(10), Duration::from_millis(20), Duration::from_millis(40)];
        let tunnel = open_with_backoff(&password_cfg(ssh_port), "127.0.0.1", echo_port, &kh, backoff).await.unwrap();
        let port = tunnel.local_port;
        assert_eq!(echo_roundtrip(port, b"before").await.unwrap(), b"before");

        // The SSH session dies abnormally; the server keeps accepting new ones.
        for h in lock(&clients).drain(..) {
            h.abort();
        }
        wait_until(|| tunnel.is_down()).await;

        // Same local port, new SSH session behind it.
        assert_eq!(tunnel.local_port, port);
        assert_eq!(echo_roundtrip(port, b"after").await.unwrap(), b"after");
    }

    #[tokio::test]
    async fn gives_up_after_the_last_backoff_and_does_not_hang() {
        let (ssh_port, clients, accept) = spawn_killable_ssh_server(ed25519_key(3)).await;
        let echo_port = spawn_echo_server().await;
        let kh = temp_known_hosts_path("reopen_gives_up");
        let backoff = vec![Duration::from_millis(10), Duration::from_millis(20), Duration::from_millis(40)];
        let tunnel = open_with_backoff(&password_cfg(ssh_port), "127.0.0.1", echo_port, &kh, backoff).await.unwrap();

        // The SSH server is gone for good.
        accept.abort();
        for h in lock(&clients).drain(..) {
            h.abort();
        }
        wait_until(|| tunnel.is_down()).await;

        let started = std::time::Instant::now();
        let res = echo_roundtrip(tunnel.local_port, b"x").await;
        assert!(res.is_err(), "{res:?}");
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn concurrent_connections_during_a_failed_reopen_share_one_cycle() {
        let (ssh_port, clients, accept) = spawn_killable_ssh_server(ed25519_key(4)).await;
        let echo_port = spawn_echo_server().await;
        let kh = temp_known_hosts_path("reopen_concurrent");
        let backoff = vec![Duration::from_millis(100), Duration::from_millis(200), Duration::from_millis(400)];
        let tunnel = open_with_backoff(&password_cfg(ssh_port), "127.0.0.1", echo_port, &kh, backoff).await.unwrap();

        accept.abort();
        for h in lock(&clients).drain(..) {
            h.abort();
        }
        wait_until(|| tunnel.is_down()).await;

        // A cycle takes ~700 ms; five connections arriving together must not take 5 x that.
        let started = std::time::Instant::now();
        let port = tunnel.local_port;
        let attempts: Vec<_> = (0..5).map(|_| tokio::spawn(async move { echo_roundtrip(port, b"x").await })).collect();
        for a in attempts {
            assert!(a.await.unwrap().is_err());
        }
        assert_eq!(tunnel.reopen_cycles(), 1);
        assert!(started.elapsed() < Duration::from_millis(2500), "{:?}", started.elapsed());

        // Right after the failed cycle a new connection fails at once, without another cycle.
        let again = std::time::Instant::now();
        assert!(echo_roundtrip(port, b"x").await.is_err());
        assert!(again.elapsed() < Duration::from_millis(300), "{:?}", again.elapsed());
        assert_eq!(tunnel.reopen_cycles(), 1);
    }

    #[tokio::test]
    async fn connect_times_out_against_a_server_that_never_answers() {
        // Accepts the TCP connection but never sends an SSH banner.
        let silent = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = silent.local_addr().unwrap().port();
        let _hold = tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((stream, _)) = silent.accept().await {
                held.push(stream);
            }
        });
        let kh = temp_known_hosts_path("connect_timeout");
        let started = std::time::Instant::now();
        let err = connect_session(&password_cfg(port), &kh, Duration::from_millis(150)).await.err().expect("must time out");
        assert!(matches!(&err, AppError::SshTunnel(m) if m.contains("timed out")), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
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
        let key_path = std::env::temp_dir().join("lumiong_test_ssh_key_ok.pem");
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
        let key_path = std::env::temp_dir().join("lumiong_test_ssh_key_encrypted.pem");
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
