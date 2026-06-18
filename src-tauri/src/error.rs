use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Connection(String),
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
            AppError::Query(m) => write!(f, "Query error: {m}"),
            AppError::Serialize(m) => write!(f, "Serialize error: {m}"),
            AppError::Parse(m) => write!(f, "Parse error: {m}"),
            AppError::Io(m) => write!(f, "IO error: {m}"),
            AppError::NotConnected => write!(f, "Not connected"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<mongodb::error::Error> for AppError {
    fn from(e: mongodb::error::Error) -> Self {
        AppError::Query(e.to_string())
    }
}
