use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One node of the saved-query library; the tree itself (parent/child) is derived in the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum QueryNode {
    #[serde(rename_all = "camelCase")]
    Folder {
        id: u32,
        parent_id: Option<u32>,
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    Query {
        id: u32,
        parent_id: Option<u32>,
        name: String,
        statement: String,
        #[serde(default)]
        db: Option<String>,
        #[serde(default)]
        updated_at: i64,
    },
}

/// Missing file → Ok(vec![]); malformed JSON → Parse error; other read errors → Io error.
pub fn load(path: &Path) -> Result<Vec<QueryNode>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn save(path: &Path, nodes: &[QueryNode]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(nodes).map_err(|e| AppError::Serialize(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: u32, parent_id: Option<u32>, name: &str) -> QueryNode {
        QueryNode::Folder { id, parent_id, name: name.into() }
    }

    fn query(id: u32, parent_id: Option<u32>, name: &str) -> QueryNode {
        QueryNode::Query {
            id,
            parent_id,
            name: name.into(),
            statement: "db.users.find()".into(),
            db: Some("app".into()),
            updated_at: 1_730_000_000_000,
        }
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("monglumio_test_qlib_roundtrip");
        let path = dir.join("query_library.json");
        let _ = std::fs::remove_dir_all(&dir);
        let nodes = vec![folder(1, None, "Reports"), query(2, Some(1), "Active users")];
        save(&path, &nodes).unwrap();
        assert_eq!(load(&path).unwrap(), nodes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_empty() {
        let path = std::env::temp_dir().join("monglumio_test_qlib_missing/nope.json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert_eq!(load(&path).unwrap(), Vec::<QueryNode>::new());
    }

    #[test]
    fn load_malformed_is_parse_error() {
        let dir = std::env::temp_dir().join("monglumio_test_qlib_malformed");
        let path = dir.join("query_library.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        assert!(matches!(load(&path), Err(AppError::Parse(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn serializes_camel_case_with_kind_tag() {
        let json = serde_json::to_string(&query(2, Some(1), "q")).unwrap();
        assert!(json.contains(r#""kind":"query""#));
        assert!(json.contains(r#""parentId":1"#));
        assert!(json.contains(r#""updatedAt":1730000000000"#));
        let json = serde_json::to_string(&folder(1, None, "f")).unwrap();
        assert!(json.contains(r#""kind":"folder""#));
        assert!(json.contains(r#""parentId":null"#));
    }

    #[test]
    fn legacy_query_without_db_and_updated_at_defaults() {
        let raw = r#"[{"kind":"query","id":1,"parentId":null,"name":"old","statement":"db.a.find()"}]"#;
        let nodes: Vec<QueryNode> = serde_json::from_str(raw).unwrap();
        let QueryNode::Query { db, updated_at, .. } = &nodes[0] else { panic!("expected query") };
        assert_eq!(*db, None);
        assert_eq!(*updated_at, 0);
    }
}
