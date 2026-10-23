//! HTTP CONNECT proxy support. The Mongo driver only speaks SOCKS5, so for an HTTP proxy we run a
//! local listener (127.0.0.1:0, like `ssh_tunnel.rs`) and point the driver at it: each accepted
//! connection asks the proxy to `CONNECT host:port`, then bytes are copied both ways.
use crate::util::lock_recover;
use crate::error::AppError;
use crate::proxy::ProxyConfig;
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// Bound for dialing the proxy and for its reply to CONNECT.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REPLY_HEADERS: usize = 16 * 1024;

fn err(msg: impl Into<String>) -> AppError {
    AppError::Connection(msg.into())
}

/// Dials the proxy and completes `CONNECT remote_host:remote_port`; on success the returned stream
/// is a raw pipe to the target. Errors carry the proxy endpoint and status line, never credentials.
pub async fn connect_through(cfg: &ProxyConfig, remote_host: &str, remote_port: u16) -> Result<TcpStream, AppError> {
    let endpoint = cfg.endpoint();
    let attempt = async {
        let mut s = TcpStream::connect((cfg.host.as_str(), cfg.port))
            .await
            .map_err(|e| err(format!("HTTP proxy {endpoint}: {e}")))?;
        let target = format!("{remote_host}:{remote_port}");
        let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
        if !cfg.user.is_empty() {
            let token = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", cfg.user, cfg.password));
            req.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
        }
        req.push_str("\r\n");
        s.write_all(req.as_bytes()).await.map_err(|e| err(format!("HTTP proxy {endpoint}: {e}")))?;

        // Read byte by byte up to the blank line so no tunnelled data is swallowed with the headers.
        let mut head = Vec::new();
        let mut b = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            if head.len() > MAX_REPLY_HEADERS {
                return Err(err(format!("HTTP proxy {endpoint}: reply headers too large")));
            }
            match s.read(&mut b).await {
                Ok(0) => return Err(err(format!("HTTP proxy {endpoint} closed the connection during CONNECT"))),
                Ok(_) => head.push(b[0]),
                Err(e) => return Err(err(format!("HTTP proxy {endpoint}: {e}"))),
            }
        }
        let text = String::from_utf8_lossy(&head);
        let status_line = text.lines().next().unwrap_or("").trim().to_string();
        let code = status_line.split_whitespace().nth(1).and_then(|c| c.parse::<u16>().ok());
        match code {
            Some(200..=299) => Ok(s),
            _ => Err(err(format!("HTTP proxy {endpoint} refused CONNECT to {target}: {status_line}"))),
        }
    };
    tokio::time::timeout(CONNECT_TIMEOUT, attempt)
        .await
        .map_err(|_| err(format!("HTTP proxy {endpoint}: CONNECT timed out")))?
}

/// Owns the accept loop and every in-flight forward; dropping it aborts them all.
#[derive(Debug)]
pub struct HttpProxyTunnelHandle {
    pub local_port: u16,
    task: JoinHandle<()>,
    forwards: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Drop for HttpProxyTunnelHandle {
    fn drop(&mut self) {
        self.task.abort();
        for h in lock_recover(&self.forwards).drain(..) {
            h.abort();
        }
    }
}

/// Opens the local listener. One CONNECT is made up front so a wrong proxy, bad credentials or a
/// denied target fail here with a clear message instead of as a driver timeout.
pub async fn open(cfg: &ProxyConfig, remote_host: &str, remote_port: u16) -> Result<HttpProxyTunnelHandle, AppError> {
    drop(connect_through(cfg, remote_host, remote_port).await?);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| err(e.to_string()))?;
    let local_port = listener.local_addr().map_err(|e| err(e.to_string()))?.port();
    let forwards: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::default();
    let (cfg, host, fw) = (cfg.clone(), remote_host.to_string(), forwards.clone());
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut local, _)) = listener.accept().await else { break };
            let (cfg, host) = (cfg.clone(), host.clone());
            let h = tokio::spawn(async move {
                if let Ok(mut remote) = connect_through(&cfg, &host, remote_port).await {
                    let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                }
            });
            let mut f = lock_recover(&fw);
            f.retain(|h| !h.is_finished());
            f.push(h);
        }
    });
    Ok(HttpProxyTunnelHandle { local_port, task, forwards })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake proxy: records the request head, answers with `reply`, then echoes bytes.
    async fn fake_proxy(reply: &'static str) -> (u16, tokio::sync::oneshot::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut head = Vec::new();
            let mut b = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") {
                if s.read(&mut b).await.unwrap() == 0 { return; }
                head.push(b[0]);
            }
            let _ = tx.send(String::from_utf8_lossy(&head).into_owned());
            s.write_all(reply.as_bytes()).await.unwrap();
            let mut buf = [0u8; 64];
            while let Ok(n) = s.read(&mut buf).await {
                if n == 0 || s.write_all(&buf[..n]).await.is_err() { break; }
            }
        });
        (port, rx)
    }

    fn cfg(port: u16, user: &str, password: &str) -> ProxyConfig {
        ProxyConfig { kind: "http".into(), host: "127.0.0.1".into(), port, user: user.into(), password: password.into() }
    }

    #[tokio::test]
    async fn http_connect_sends_auth_header() {
        let (port, rx) = fake_proxy("HTTP/1.1 200 Connection established\r\n\r\n").await;
        let mut s = connect_through(&cfg(port, "alice", "s3cret"), "db.internal", 27017).await.unwrap();
        let head = rx.await.unwrap();
        assert!(head.starts_with("CONNECT db.internal:27017 HTTP/1.1\r\n"), "{head}");
        let expected = base64::engine::general_purpose::STANDARD.encode("alice:s3cret");
        assert!(head.contains(&format!("Proxy-Authorization: Basic {expected}\r\n")), "{head}");
        // The stream is a pipe afterwards.
        s.write_all(b"ping").await.unwrap();
        let mut got = [0u8; 4];
        s.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"ping");
    }

    #[tokio::test]
    async fn http_connect_without_credentials_sends_no_auth_header() {
        let (port, rx) = fake_proxy("HTTP/1.0 200 OK\r\n\r\n").await;
        connect_through(&cfg(port, "", ""), "h", 1).await.unwrap();
        assert!(!rx.await.unwrap().contains("Proxy-Authorization"));
    }

    #[tokio::test]
    async fn http_connect_accepts_any_2xx() {
        let (port, _rx) = fake_proxy("HTTP/1.1 204 No Content\r\n\r\n").await;
        assert!(connect_through(&cfg(port, "", ""), "h", 1).await.is_ok());
    }

    #[tokio::test]
    async fn http_connect_non_200_is_connection_error() {
        let (port, _rx) = fake_proxy("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n").await;
        let e = connect_through(&cfg(port, "u", "topsecret"), "h", 1).await.unwrap_err();
        assert!(matches!(e, AppError::Connection(_)));
        let msg = e.to_string();
        assert!(msg.contains("407"), "{msg}");
        assert!(!msg.contains("topsecret"), "{msg}");
    }

    #[tokio::test]
    async fn unreachable_proxy_is_connection_error() {
        let port = { std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port() };
        assert!(matches!(connect_through(&cfg(port, "", ""), "h", 1).await, Err(AppError::Connection(_))));
    }

    #[tokio::test]
    async fn local_listener_forwards_through_the_proxy() {
        // open() makes a preflight CONNECT and then one per client, so the fake must keep accepting.
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let pport = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut b = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if s.read(&mut b).await.unwrap_or(0) == 0 { return; }
                        head.push(b[0]);
                    }
                    s.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
                    let mut buf = [0u8; 64];
                    while let Ok(n) = s.read(&mut buf).await {
                        if n == 0 || s.write_all(&buf[..n]).await.is_err() { break; }
                    }
                });
            }
        });
        let handle = open(&cfg(pport, "", ""), "h", 27017).await.unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", handle.local_port)).await.unwrap();
        c.write_all(b"hello").await.unwrap();
        let mut got = [0u8; 5];
        c.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"hello");
    }

    #[tokio::test]
    async fn open_fails_fast_when_the_proxy_denies() {
        let (port, _rx) = fake_proxy("HTTP/1.1 403 Forbidden\r\n\r\n").await;
        assert!(open(&cfg(port, "", ""), "h", 1).await.is_err());
    }
}
