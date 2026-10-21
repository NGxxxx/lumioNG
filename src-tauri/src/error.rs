use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug)]
pub enum AppError {
    Connection(String),
    SshTunnel(String),
    Query(String),
    /// A server-reported failure; shown and serialized like `Query`, but keeps the code so the
    /// audit log can record it without the (value-bearing) message.
    Server { code: i32, code_name: String, message: String },
    Serialize(String),
    Parse(String),
    Io(String),
    /// Master-password vault failures (wrong password, corrupted vault); never carries secret material.
    Vault(String),
    NotConnected,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Connection(m) => write!(f, "Connection error: {m}"),
            AppError::SshTunnel(m) => write!(f, "SSH tunnel error: {m}"),
            AppError::Query(m) | AppError::Server { message: m, .. } => write!(f, "Query error: {m}"),
            AppError::Serialize(m) => write!(f, "Serialize error: {m}"),
            AppError::Parse(m) => write!(f, "Parse error: {m}"),
            AppError::Io(m) => write!(f, "IO error: {m}"),
            AppError::Vault(m) => write!(f, "Vault error: {m}"),
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
            AppError::Query(m) | AppError::Server { message: m, .. } => ("Query", Some(m)),
            AppError::Serialize(m) => ("Serialize", Some(m)),
            AppError::Parse(m) => ("Parse", Some(m)),
            AppError::Io(m) => ("Io", Some(m)),
            AppError::Vault(m) => ("Vault", Some(m)),
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
        let message = friendly_mongo_message(&e);
        match server_code(&e) {
            Some((code, code_name)) => AppError::Server { code, code_name, message },
            None => AppError::Query(message),
        }
    }
}

/// The server's error code and codeName for command, write and insertMany failures.
fn server_code(e: &mongodb::error::Error) -> Option<(i32, String)> {
    use mongodb::error::{ErrorKind, WriteFailure};
    let (code, name) = match e.kind.as_ref() {
        ErrorKind::Command(c) => (c.code, Some(c.code_name.clone())),
        ErrorKind::Write(WriteFailure::WriteError(w)) => (w.code, w.code_name.clone()),
        ErrorKind::InsertMany(m) => {
            let w = m.write_errors.as_ref()?.first()?;
            (w.code, w.code_name.clone())
        }
        _ => return None,
    };
    let name = name.filter(|n| !n.is_empty()).unwrap_or_else(|| known_code_name(code).to_string());
    Some((code, name))
}

/// Names for the codes the server sometimes sends without a `codeName`.
fn known_code_name(code: i32) -> &'static str {
    match code {
        11000 | 11001 | 12582 => "DuplicateKey",
        121 => "DocumentValidationFailure",
        _ => "",
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
        #[cfg(feature = "csfle")]
        mongodb::error::ErrorKind::Encryption(e) => format!("{ENCRYPTION_PREFIX}{e}"),
        kind => kind.to_string(),
    }
}

/// Start of every message that comes from libmongocrypt (a key that cannot be fetched or used).
pub const ENCRYPTION_PREFIX: &str = "Encryption: ";

impl AppError {
    /// A libmongocrypt failure: on a read it means encrypted fields could not be decrypted.
    pub fn is_encryption(&self) -> bool {
        matches!(self, AppError::Query(m) if m.starts_with(ENCRYPTION_PREFIX))
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
    fn libmongocrypt_failures_are_recognised() {
        assert!(AppError::Query(format!("{ENCRYPTION_PREFIX}key not found")).is_encryption());
        assert!(!AppError::Query("Connection is read-only".into()).is_encryption());
        assert!(!AppError::Parse(format!("{ENCRYPTION_PREFIX}x")).is_encryption());
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
