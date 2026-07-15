use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Connection(String),
    SshTunnel(String),
    Query(String),
    Serialize(String),
    Parse(String),
    Io(String),
    NotConnected,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Connection(m) => write!(f, "Connection error: {m}"),
            AppError::SshTunnel(m) => write!(f, "SSH tunnel error: {m}"),
            AppError::Query(m) => write!(f, "Query error: {m}"),
            AppError::Serialize(m) => write!(f, "Serialize error: {m}"),
            AppError::Parse(m) => write!(f, "Parse error: {m}"),
            AppError::Io(m) => write!(f, "IO error: {m}"),
            AppError::NotConnected => write!(f, "Not connected"),
        }
    }
}

impl std::error::Error for AppError {}

/// Reject an operation when the connection is read-only.
pub fn ensure_writable(read_only: bool) -> Result<(), AppError> {
    if read_only {
        Err(AppError::Query("Connection is read-only".into()))
    } else {
        Ok(())
    }
}

impl From<mongodb::error::Error> for AppError {
    fn from(e: mongodb::error::Error) -> Self {
        AppError::Query(friendly_mongo_message(&e))
    }
}

/// Short message instead of `Error`'s raw `Kind/labels/source/server response` dump.
fn friendly_mongo_message(e: &mongodb::error::Error) -> String {
    match e.kind.as_ref() {
        mongodb::error::ErrorKind::Command(cmd) => format!(
            "{} (code {}): {}",
            cmd.code_name,
            cmd.code,
            trim_embedded_command(&cmd.message)
        ),
        kind => kind.to_string(),
    }
}

fn trim_embedded_command(message: &str) -> &str {
    match message.find("command {") {
        Some(idx) => message[..idx + "command".len()].trim_end(),
        None => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_tunnel_variant_serializes_with_kind_and_message() {
        let err = AppError::SshTunnel("auth rejected".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, r#"{"kind":"SshTunnel","message":"auth rejected"}"#);
    }

    #[test]
    fn ssh_tunnel_display_is_prefixed() {
        let err = AppError::SshTunnel("auth rejected".into());
        assert_eq!(err.to_string(), "SSH tunnel error: auth rejected");
    }

    #[test]
    fn trim_embedded_command_strips_command_document() {
        let msg = "not authorized on admin to execute command { rolesInfo: 1, \
                    showPrivileges: true, $db: \"admin\", lsid: { id: UUID(\"...\") } }";
        assert_eq!(
            trim_embedded_command(msg),
            "not authorized on admin to execute command"
        );
    }

    #[test]
    fn trim_embedded_command_leaves_plain_message_untouched() {
        let msg = "index build failed: duplicate key error";
        assert_eq!(trim_embedded_command(msg), msg);
    }
}
