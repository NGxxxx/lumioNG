use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug)]
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

/// Wire format `{ "kind": …, "message": … }` (no `message` for `NotConnected`). Every error that
/// reaches the frontend is written to the log at `warn`, redacted, as it is serialized.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (kind, message) = match self {
            AppError::Connection(m) => ("Connection", Some(m)),
            AppError::SshTunnel(m) => ("SshTunnel", Some(m)),
            AppError::Query(m) => ("Query", Some(m)),
            AppError::Serialize(m) => ("Serialize", Some(m)),
            AppError::Parse(m) => ("Parse", Some(m)),
            AppError::Io(m) => ("Io", Some(m)),
            AppError::NotConnected => ("NotConnected", None),
        };
        tracing::warn!(kind, "{}", crate::redact::redact_text(&self.to_string()));
        let mut s = serializer.serialize_struct("AppError", if message.is_some() { 2 } else { 1 })?;
        s.serialize_field("kind", kind)?;
        if let Some(m) = message {
            s.serialize_field("message", m)?;
        }
        s.end()
    }
}

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
    fn not_connected_serializes_without_message() {
        assert_eq!(serde_json::to_string(&AppError::NotConnected).unwrap(), r#"{"kind":"NotConnected"}"#);
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
