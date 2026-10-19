//! Just enough HTTP/1.1 for the MCP Streamable HTTP transport: one request per connection, a
//! `Content-Length` body, a plain JSON (or empty) response, then close. No chunked bodies, no
//! keep-alive, no SSE — MCP clients fall back to plain JSON responses when the server sends them.

use tokio::io::{AsyncRead, AsyncReadExt};

/// Header block cap: anything bigger is not an MCP client talking to us.
const MAX_HEAD: usize = 16 * 1024;
/// Request body cap (a large `insert_documents` call still fits comfortably).
pub const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    /// Case-insensitive header lookup (first occurrence).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, PartialEq)]
pub enum ReadError {
    /// The peer closed the socket before sending a request line.
    Closed,
    /// Malformed or oversized request; answered with this status code.
    Bad(u16, &'static str),
}

/// Reads one request (head + `Content-Length` body) from `r`.
pub async fn read_request<R: AsyncRead + Unpin>(r: &mut R) -> Result<Request, ReadError> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = find_head_end(&buf) {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err(ReadError::Bad(431, "request header too large"));
        }
        let n = r.read(&mut chunk).await.map_err(|_| ReadError::Closed)?;
        if n == 0 {
            return Err(if buf.is_empty() { ReadError::Closed } else { ReadError::Bad(400, "truncated request") });
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| ReadError::Bad(400, "header is not UTF-8"))?;
    let mut lines = head.split("\r\n");
    let mut start = lines.next().unwrap_or("").split(' ');
    let method = start.next().unwrap_or("").to_string();
    let path = start.next().unwrap_or("").to_string();
    if method.is_empty() || path.is_empty() {
        return Err(ReadError::Bad(400, "bad request line"));
    }
    let mut headers = Vec::new();
    for line in lines {
        let Some((k, v)) = line.split_once(':') else { return Err(ReadError::Bad(400, "bad header line")) };
        headers.push((k.trim().to_string(), v.trim().to_string()));
    }
    let mut req = Request { method, path, headers, body: Vec::new() };
    if req.header("transfer-encoding").is_some() {
        return Err(ReadError::Bad(411, "chunked bodies are not supported; send Content-Length"));
    }
    let len = match req.header("content-length") {
        Some(v) => v.parse::<usize>().map_err(|_| ReadError::Bad(400, "bad Content-Length"))?,
        None => 0,
    };
    if len > MAX_BODY {
        return Err(ReadError::Bad(413, "request body too large"));
    }

    let mut body = buf.split_off(head_end + 4);
    if body.len() > len {
        body.truncate(len);
    }
    while body.len() < len {
        let n = r.read(&mut chunk).await.map_err(|_| ReadError::Closed)?;
        if n == 0 {
            return Err(ReadError::Bad(400, "truncated body"));
        }
        let take = n.min(len - body.len());
        body.extend_from_slice(&chunk[..take]);
    }
    req.body = body;
    Ok(req)
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    }
}

/// Serializes a complete response; `Connection: close` since every connection carries one request.
pub fn response(status: u16, content_type: Option<&str>, body: &[u8], extra: &[(&str, &str)]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} {}\r\nContent-Length: {}\r\nConnection: close\r\n", reason(status), body.len());
    if let Some(ct) = content_type {
        out.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    for (k, v) in extra {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    let mut bytes = out.into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn parse(raw: &[u8]) -> Result<Request, ReadError> {
        let mut r = raw;
        read_request(&mut r).await
    }

    #[tokio::test]
    async fn reads_head_and_body() {
        let req = parse(b"POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\nAuthorization: Bearer t\r\n\r\nabcdEXTRA").await.unwrap();
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/mcp");
        assert_eq!(req.header("authorization"), Some("Bearer t"));
        assert_eq!(req.body, b"abcd");
    }

    #[tokio::test]
    async fn missing_content_length_means_empty_body() {
        let req = parse(b"GET /mcp HTTP/1.1\r\n\r\n").await.unwrap();
        assert!(req.body.is_empty());
    }

    #[tokio::test]
    async fn empty_stream_is_closed_and_truncation_is_bad() {
        assert_eq!(parse(b"").await.unwrap_err(), ReadError::Closed);
        assert_eq!(parse(b"POST /mcp HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc").await.unwrap_err(), ReadError::Bad(400, "truncated body"));
    }

    #[tokio::test]
    async fn rejects_chunked_and_oversized() {
        assert!(matches!(parse(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").await, Err(ReadError::Bad(411, _))));
        let big = format!("POST / HTTP/1.1\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1);
        assert!(matches!(parse(big.as_bytes()).await, Err(ReadError::Bad(413, _))));
    }

    #[test]
    fn response_has_length_and_close() {
        let r = String::from_utf8(response(200, Some("application/json"), b"{}", &[("X-A", "1")])).unwrap();
        assert!(r.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(r.contains("Content-Length: 2\r\n"));
        assert!(r.contains("Connection: close\r\n"));
        assert!(r.contains("X-A: 1\r\n"));
        assert!(r.ends_with("\r\n\r\n{}"));
    }
}
