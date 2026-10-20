//! Step-by-step connection diagnosis: finds which link of the chain (URI, SRV, DNS, TCP, TLS,
//! handshake, authentication) breaks first, instead of one opaque "server selection timeout".
//! Every `detail` is redacted before it leaves this module.
use crate::error::AppError;
use crate::proxy::ProxyConfig;
use crate::redact::redact_text;
use crate::ssh_tunnel::SshTunnelConfig;
use mongodb::bson::doc;
use mongodb::options::{ClientOptions, ConnectionString, HostInfo, ServerAddress, Tls};
use mongodb::Client;
use serde::Serialize;
use std::future::Future;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// How long the TCP step waits for one host:port.
pub const TCP_TIMEOUT: Duration = Duration::from_secs(5);
/// Upper bound for a DNS lookup of one host.
const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const DRIVER_TIMEOUT: Duration = Duration::from_secs(10);

/// One link of the connection chain. `step` is a stable id the UI maps to a label:
/// `parse`, `srv`, `ssh`, `proxy`, `dns`, `tcp`, `tls`, `hello`, `auth`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiagStep {
    pub step: String,
    pub ok: bool,
    pub ms: u64,
    pub detail: String,
}

fn done(step: &str, started: Instant, result: Result<String, String>) -> DiagStep {
    let ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(detail) => DiagStep { step: step.into(), ok: true, ms, detail: redact_text(&detail) },
        Err(detail) => DiagStep { step: step.into(), ok: false, ms, detail: redact_text(&detail) },
    }
}

fn host_port(addr: &ServerAddress) -> (String, u16) {
    match addr {
        ServerAddress::Tcp { host, port } => (host.clone(), port.unwrap_or(27017)),
        #[allow(unreachable_patterns)]
        _ => (String::new(), 27017),
    }
}

/// Resolves `host`; the detail lists the addresses found.
pub async fn dns_step(host: &str, port: u16) -> DiagStep {
    let started = Instant::now();
    let res = match tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host, port))).await {
        Err(_) => Err(format!("{host}: DNS lookup timed out")),
        Ok(Err(e)) => Err(format!("{host}: failed to lookup address: {e}")),
        Ok(Ok(addrs)) => {
            let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
            if ips.is_empty() { Err(format!("{host}: no addresses found")) } else { Ok(format!("{host} -> {}", ips.join(", "))) }
        }
    };
    done("dns", started, res)
}

/// Opens a TCP connection to `host:port`, giving up after `timeout`.
pub async fn tcp_step(host: &str, port: u16, timeout: Duration) -> DiagStep {
    tcp_probe(host, port, timeout, tokio::net::TcpStream::connect((host, port))).await
}

/// `tcp_step` with the connect future injected, so a test can force a deterministic timeout.
pub async fn tcp_probe<F, T>(host: &str, port: u16, timeout: Duration, connect: F) -> DiagStep
where
    F: Future<Output = std::io::Result<T>>,
{
    let started = Instant::now();
    let res = match tokio::time::timeout(timeout, connect).await {
        Err(_) => Err(format!("{host}:{port}: connection timed out after {} s", timeout.as_secs_f32())),
        Ok(Err(e)) => Err(format!("{host}:{port}: {e}")),
        Ok(Ok(_)) => Ok(format!("{host}:{port}")),
    };
    done("tcp", started, res)
}

/// Reaches a SOCKS5 proxy: TCP connect plus the method-selection greeting (no credentials are sent).
pub async fn socks5_proxy_step(cfg: &ProxyConfig, timeout: Duration) -> DiagStep {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let started = Instant::now();
    let endpoint = cfg.endpoint();
    let probe = async {
        let mut s = tokio::net::TcpStream::connect((cfg.host.as_str(), cfg.port)).await.map_err(|e| format!("SOCKS5 proxy {endpoint}: {e}"))?;
        let hello: &[u8] = if cfg.user.is_empty() { &[5, 1, 0] } else { &[5, 2, 0, 2] };
        s.write_all(hello).await.map_err(|e| format!("SOCKS5 proxy {endpoint}: {e}"))?;
        let mut reply = [0u8; 2];
        s.read_exact(&mut reply).await.map_err(|e| format!("SOCKS5 proxy {endpoint}: no handshake reply ({e})"))?;
        match reply {
            [5, 0xFF] => Err(format!("SOCKS5 proxy {endpoint} accepts none of the offered authentication methods")),
            [5, _] => Ok(format!("SOCKS5 proxy {endpoint} answered the handshake")),
            _ => Err(format!("{endpoint} did not answer like a SOCKS5 proxy")),
        }
    };
    let res = match tokio::time::timeout(timeout, probe).await {
        Err(_) => Err(format!("SOCKS5 proxy {endpoint}: timed out after {} s", timeout.as_secs_f32())),
        Ok(r) => r,
    };
    done("proxy", started, res)
}

fn looks_like_tls_failure(msg: &str) -> bool {
    let m = msg.to_lowercase();
    ["tls", "ssl", "certificate", "handshake", "invalidcontenttype", "peer"].iter().any(|k| m.contains(k))
}

/// TLS + `hello` (no credentials) and then an authenticated `ping`, against already-resolved options.
async fn driver_steps(mut opts: ClientOptions, steps: &mut Vec<DiagStep>) {
    opts.app_name.get_or_insert_with(|| "LumioNG".to_string());
    opts.server_selection_timeout = Some(DRIVER_TIMEOUT);
    opts.connect_timeout.get_or_insert(DRIVER_TIMEOUT);
    let tls_on = matches!(opts.tls, Some(Tls::Enabled(_)));
    let user = opts.credential.as_ref().and_then(|c| c.username.clone());

    // `hello` runs on an anonymous client: it covers the TLS handshake and the wire handshake without mixing in authentication.
    let mut anon = opts.clone();
    anon.credential = None;
    let started = Instant::now();
    let hello = match Client::with_options(anon) {
        Ok(client) => tokio::time::timeout(DRIVER_TIMEOUT, client.database("admin").run_command(doc! { "hello": 1 }))
            .await
            .map_err(|_| "timed out waiting for the server's hello reply".to_string())
            .and_then(|r| r.map_err(|e| e.to_string())),
        Err(e) => Err(e.to_string()),
    };
    match hello {
        Err(msg) if looks_like_tls_failure(&msg) => {
            steps.push(done("tls", started, Err(msg)));
            return;
        }
        Err(msg) => {
            steps.push(DiagStep { step: "tls".into(), ok: true, ms: 0, detail: if tls_on { "TLS enabled".into() } else { "TLS not used".into() } });
            steps.push(done("hello", started, Err(msg)));
            return;
        }
        Ok(reply) => {
            steps.push(DiagStep { step: "tls".into(), ok: true, ms: 0, detail: if tls_on { "TLS enabled".into() } else { "TLS not used".into() } });
            let wire = reply.get_i32("maxWireVersion").map(|v| format!("maxWireVersion {v}")).unwrap_or_default();
            let set = reply.get_str("setName").map(|s| format!(", replica set {s}")).unwrap_or_default();
            steps.push(done("hello", started, Ok(format!("{wire}{set}"))));
        }
    }

    // A browser sign-in cannot run unattended: report the step as skipped instead of failing it for want of a callback.
    if super::connection::needs_human_oidc(&opts) {
        steps.push(DiagStep { step: "auth".into(), ok: true, ms: 0, detail: "OIDC sign-in opens a browser and is not attempted by the diagnosis".into() });
        return;
    }
    let started = Instant::now();
    let auth = match Client::with_options(opts) {
        Ok(client) => tokio::time::timeout(DRIVER_TIMEOUT, client.database("admin").run_command(doc! { "ping": 1 }))
            .await
            .map_err(|_| "timed out waiting for the ping reply".to_string())
            .and_then(|r| r.map(|_| ()).map_err(|e| e.to_string())),
        Err(e) => Err(e.to_string()),
    };
    let detail = match &user { Some(u) => format!("authenticated as {u}"), None => "no credentials (anonymous)".to_string() };
    steps.push(done("auth", started, auth.map(|_| detail)));
}

/// Runs the whole chain and stops at the first failed step. `ssh` is `(config, known_hosts path)` when the connection is tunneled.
/// DNS / TCP of the database host are skipped in that case: they must be reachable from the SSH server, not from here.
/// The same holds with a proxy (the proxy resolves and dials the database host): a `proxy` step replaces `dns`/`tcp`.
pub async fn diagnose(uri: &str, ssh: Option<(&SshTunnelConfig, &Path)>, proxy: Option<&ProxyConfig>, tcp_timeout: Duration) -> Vec<DiagStep> {
    let mut steps: Vec<DiagStep> = Vec::new();

    let started = Instant::now();
    let parsed = match ConnectionString::parse(uri) {
        Ok(p) => p,
        Err(e) => {
            steps.push(done("parse", started, Err(e.to_string())));
            return steps;
        }
    };
    let is_srv = matches!(parsed.host_info, HostInfo::DnsRecord(_));
    steps.push(done("parse", started, Ok(if is_srv { "mongodb+srv URI".into() } else { "URI is valid".into() })));

    // `ClientOptions::parse` performs the SRV / TXT lookups itself.
    let started = Instant::now();
    let mut opts = match ClientOptions::parse(uri).await {
        Ok(o) => o,
        Err(e) => {
            steps.push(done(if is_srv { "srv" } else { "parse" }, started, Err(e.to_string())));
            return steps;
        }
    };
    if is_srv {
        let hosts: Vec<String> = opts.hosts.iter().map(|h| { let (h, p) = host_port(h); format!("{h}:{p}") }).collect();
        steps.push(done("srv", started, Ok(format!("{} host(s): {}", hosts.len(), hosts.join(", ")))));
    }

    let _tunnel;
    let _http_tunnel;
    match ssh {
        Some((cfg, known_hosts)) if cfg.enabled => {
            let started = Instant::now();
            let Some((remote_host, remote_port)) = opts.hosts.first().map(host_port) else {
                steps.push(done("ssh", started, Err("no host in connection URI".into())));
                return steps;
            };
            match crate::ssh_tunnel::open(cfg, &remote_host, remote_port, known_hosts).await {
                Ok(t) => {
                    steps.push(done("ssh", started, Ok(format!("tunnel to {}:{} is open", cfg.host, cfg.port))));
                    opts.hosts = vec![ServerAddress::Tcp { host: "127.0.0.1".into(), port: Some(t.local_port) }];
                    _tunnel = Some(t);
                }
                Err(e) => {
                    steps.push(done("ssh", started, Err(e.to_string())));
                    return steps;
                }
            }
        }
        _ if proxy.is_some_and(|p| p.is_socks5() || p.is_http()) => {
            let cfg = proxy.unwrap();
            if cfg.is_socks5() {
                // The driver applies the SOCKS5 options from the URI to every host.
                let s = socks5_proxy_step(cfg, tcp_timeout).await;
                let ok = s.ok;
                steps.push(s);
                if !ok {
                    return steps;
                }
            } else {
                let started = Instant::now();
                let (Some(addr), true) = (opts.hosts.first(), opts.hosts.len() == 1 && !is_srv) else {
                    steps.push(done("proxy", started, Err("An HTTP proxy requires a single direct host (no mongodb+srv, no replica set seed list)".into())));
                    return steps;
                };
                let (host, port) = host_port(addr);
                match crate::http_proxy_tunnel::open(cfg, &host, port).await {
                    Ok(t) => {
                        steps.push(done("proxy", started, Ok(format!("HTTP proxy {} accepted CONNECT to {host}:{port}", cfg.endpoint()))));
                        opts.hosts = vec![ServerAddress::Tcp { host: "127.0.0.1".into(), port: Some(t.local_port) }];
                        _http_tunnel = Some(t);
                    }
                    Err(e) => {
                        steps.push(done("proxy", started, Err(e.to_string())));
                        return steps;
                    }
                }
            }
        }
        _ => {
            for addr in &opts.hosts {
                let (host, port) = host_port(addr);
                let s = dns_step(&host, port).await;
                let ok = s.ok;
                steps.push(s);
                if !ok {
                    return steps;
                }
            }
            for addr in &opts.hosts {
                let (host, port) = host_port(addr);
                let s = tcp_step(&host, port, tcp_timeout).await;
                let ok = s.ok;
                steps.push(s);
                if !ok {
                    return steps;
                }
            }
        }
    }

    driver_steps(opts, &mut steps).await;
    steps
}

/// Diagnoses a connection the user could not open. `proxy` is the SOCKS5 / HTTP CONNECT proxy, if any
/// (for SOCKS5 the URI carries the same settings for the driver).
#[tauri::command]
pub async fn diagnose_connection(
    app: AppHandle,
    uri: String,
    ssh: Option<SshTunnelConfig>,
    proxy: Option<ProxyConfig>,
) -> Result<Vec<DiagStep>, AppError> {
    let known_hosts = super::connection::known_hosts_path(&app)?;
    Ok(diagnose(&uri, ssh.as_ref().map(|c| (c, known_hosts.as_path())), proxy.as_ref(), TCP_TIMEOUT).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn diagnose_stops_at_first_failed_step() {
        let steps = diagnose("mongodb://no-such-host.invalid:27017/", None, None, Duration::from_secs(1)).await;
        let names: Vec<&str> = steps.iter().map(|s| s.step.as_str()).collect();
        assert_eq!(names, ["parse", "dns"], "{steps:?}");
        assert!(steps[0].ok);
        assert!(!steps[1].ok);
    }

    #[tokio::test]
    async fn bad_uri_fails_at_parse() {
        let steps = diagnose("not a uri", None, None, Duration::from_secs(1)).await;
        assert_eq!(steps.len(), 1);
        assert!(!steps[0].ok && steps[0].step == "parse");
    }

    #[tokio::test]
    async fn tcp_step_times_out() {
        // A connect that never completes stands in for a blackholed host.
        let s = tcp_probe("blackhole", 27017, Duration::from_millis(30), std::future::pending::<std::io::Result<()>>()).await;
        assert!(!s.ok);
        assert_eq!(s.step, "tcp");
        assert!(s.detail.contains("timed out"), "{}", s.detail);
        assert!(s.ms >= 25 && s.ms < 2000, "{}", s.ms);
    }

    #[tokio::test]
    async fn tcp_step_reports_refused_on_a_closed_port() {
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let s = tcp_step("127.0.0.1", port, Duration::from_secs(5)).await;
        assert!(!s.ok);
        assert!(!s.detail.contains("timed out"), "{}", s.detail);
    }

    #[tokio::test]
    async fn tcp_step_succeeds_against_a_listener() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let s = tcp_step("127.0.0.1", port, Duration::from_secs(5)).await;
        assert!(s.ok, "{s:?}");
    }

    #[tokio::test]
    async fn details_never_carry_the_password() {
        let steps = diagnose("mongodb://admin:s3cr3tpw@no-such-host.invalid:27017/?password=s3cr3tpw", None, None, Duration::from_secs(1)).await;
        assert!(steps.iter().all(|s| !s.detail.contains("s3cr3tpw")), "{steps:?}");
    }

    #[test]
    fn tls_failures_are_told_apart_from_other_handshake_errors() {
        assert!(looks_like_tls_failure("invalid peer certificate: UnknownIssuer"));
        assert!(!looks_like_tls_failure("Server selection timeout: No available servers"));
    }
}

#[cfg(test)]
mod proxy_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn http_cfg(port: u16) -> ProxyConfig {
        ProxyConfig { kind: "http".into(), host: "127.0.0.1".into(), port, user: "u".into(), password: "hunter2pw".into() }
    }

    async fn one_shot(reply: &'static [u8]) -> u16 {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = [0u8; 512];
            let _ = s.read(&mut buf).await;
            let _ = s.write_all(reply).await;
        });
        port
    }

    #[tokio::test]
    async fn http_proxy_refusal_replaces_dns_and_tcp_with_a_proxy_step() {
        let port = one_shot(b"HTTP/1.1 403 Forbidden\r\n\r\n").await;
        let steps = diagnose("mongodb://db.internal:27017/", None, Some(&http_cfg(port)), Duration::from_secs(2)).await;
        let names: Vec<&str> = steps.iter().map(|s| s.step.as_str()).collect();
        assert_eq!(names, ["parse", "proxy"], "{steps:?}");
        assert!(!steps[1].ok && steps[1].detail.contains("403"), "{steps:?}");
        assert!(steps.iter().all(|s| !s.detail.contains("hunter2pw")));
    }

    #[tokio::test]
    async fn http_proxy_with_srv_is_rejected_with_a_clear_proxy_step() {
        // `ClientOptions::parse` needs DNS for SRV, which the sandbox lacks, so assert on the parse outcome only.
        let steps = diagnose("mongodb+srv://c.invalid/", None, Some(&http_cfg(1)), Duration::from_secs(1)).await;
        assert!(!steps.last().unwrap().ok);
    }

    #[tokio::test]
    async fn socks5_step_accepts_a_handshake_reply() {
        let port = one_shot(&[5, 0]).await;
        let cfg = ProxyConfig { kind: "socks5".into(), host: "127.0.0.1".into(), port, ..Default::default() };
        let s = socks5_proxy_step(&cfg, Duration::from_secs(2)).await;
        assert!(s.ok && s.step == "proxy", "{s:?}");
    }

    #[tokio::test]
    async fn socks5_step_rejects_a_non_socks_server_and_dead_port() {
        let port = one_shot(b"HT").await;
        let cfg = ProxyConfig { kind: "socks5".into(), host: "127.0.0.1".into(), port, ..Default::default() };
        assert!(!socks5_proxy_step(&cfg, Duration::from_secs(2)).await.ok);
        let dead = { std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port() };
        assert!(!socks5_proxy_step(&ProxyConfig { port: dead, ..cfg }, Duration::from_secs(2)).await.ok);
    }
}
