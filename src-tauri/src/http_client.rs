//! The one place outbound HTTP clients are built (OIDC discovery and token endpoint, the Atlas Admin
//! API), so proxy support, timeouts and TLS (rustls, no OpenSSL) stay consistent.
use crate::error::AppError;
use crate::proxy::ProxyConfig;
use std::time::Duration;

/// A client that goes through `proxy` (HTTP CONNECT or SOCKS5, with its credentials) when one is
/// set, and straight to the host otherwise. Environment proxy variables are deliberately ignored:
/// like the Mongo driver, the app only uses the proxy a connection was configured with.
///
/// It never follows a redirect: token, discovery and Admin API requests carry credentials and must
/// only ever reach the endpoint they were sent to.
pub fn build_no_redirect(proxy: Option<&ProxyConfig>, timeout: Duration) -> Result<reqwest::Client, AppError> {
    let mut b = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(15)))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("LumioNG/", env!("CARGO_PKG_VERSION")))
        .no_proxy();
    if let Some(p) = proxy.filter(|p| (p.is_http() || p.is_socks5()) && !p.host.is_empty()) {
        // The error text of reqwest can echo the proxy URL, which carries credentials: say only what failed.
        let proxy = reqwest::Proxy::all(p.url()).map_err(|_| AppError::Connection(format!("invalid proxy settings for {}", p.endpoint())))?;
        b = b.proxy(proxy);
    }
    b.build().map_err(|e| AppError::Connection(format!("could not build the HTTP client: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn without_a_proxy_it_connects_directly() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf).await;
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
        });
        let c = build_no_redirect(None, Duration::from_secs(5)).unwrap();
        assert_eq!(c.get(format!("http://127.0.0.1:{port}/")).send().await.unwrap().text().await.unwrap(), "ok");
    }

    #[tokio::test]
    async fn an_http_proxy_receives_the_request_with_its_credentials() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let seen = tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = s.read(&mut buf).await.unwrap();
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
            String::from_utf8_lossy(&buf[..n]).to_string()
        });
        let cfg = ProxyConfig { kind: "http".into(), host: "127.0.0.1".into(), port, user: "u".into(), password: "p".into() };
        let c = build_no_redirect(Some(&cfg), Duration::from_secs(5)).unwrap();
        let body = c.get("http://idp.example.test/.well-known/openid-configuration").send().await.unwrap().text().await.unwrap();
        assert_eq!(body, "ok");
        let req = seen.await.unwrap();
        assert!(req.starts_with("GET http://idp.example.test/.well-known/openid-configuration HTTP/1.1"), "{req}");
        assert!(req.to_lowercase().contains("proxy-authorization: basic "), "{req}");
    }

    #[tokio::test]
    async fn the_no_redirect_client_does_not_follow_a_307() {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let tport = target.local_addr().unwrap().port();
        let hit = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let h = hit.clone();
        tokio::spawn(async move {
            if target.accept().await.is_ok() {
                h.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        });
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf).await;
            let r = format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:{tport}/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            s.write_all(r.as_bytes()).await.unwrap();
        });
        let c = build_no_redirect(None, Duration::from_secs(5)).unwrap();
        let resp = c.post(format!("http://127.0.0.1:{port}/token")).form(&[("refresh_token", "rt")]).send().await.unwrap();
        assert_eq!(resp.status().as_u16(), 307);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!hit.load(std::sync::atomic::Ordering::SeqCst), "the redirect target was contacted");
    }

    #[test]
    fn a_socks5_proxy_builds() {
        let cfg = ProxyConfig { kind: "socks5".into(), host: "127.0.0.1".into(), port: 1080, user: "u".into(), password: "p@ss".into() };
        assert!(build_no_redirect(Some(&cfg), Duration::from_secs(5)).is_ok());
    }
}
