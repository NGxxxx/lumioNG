use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// One node of the saved-query library; on disk, `manifest.json` holds metadata and each Query's statement lives in its own `<id>.json`.
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

impl QueryNode {
    fn id(&self) -> u32 {
        match self {
            QueryNode::Folder { id, .. } | QueryNode::Query { id, .. } => *id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ManifestEntry {
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
        #[serde(default)]
        updated_at: i64,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct QueryContent {
    statement: String,
    #[serde(default)]
    db: Option<String>,
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("manifest.json")
}

fn query_file_path(dir: &Path, id: u32) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// One-time migration from the old single-file `query_library.json` into manifest+per-file; legacy file renamed to `.bak`, not deleted.
pub fn migrate_legacy(legacy_path: &Path, dir: &Path) -> Result<(), AppError> {
    if manifest_path(dir).exists() || !legacy_path.exists() {
        return Ok(());
    }
    let s = std::fs::read_to_string(legacy_path).map_err(|e| AppError::Io(e.to_string()))?;
    let nodes: Vec<QueryNode> =
        serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string()))?;
    save(dir, &nodes)?;
    let backup = legacy_path.with_file_name("query_library.json.bak");
    std::fs::rename(legacy_path, backup).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

fn read_query_content(dir: &Path, id: u32) -> Result<QueryContent, AppError> {
    match std::fs::read_to_string(query_file_path(dir, id)) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::Io(format!("missing saved-query file for id {id}")))
        }
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

/// Missing manifest → Ok(vec![]) (fresh install); malformed manifest/content → Parse error;
/// other read errors → Io error.
pub fn load(dir: &Path) -> Result<Vec<QueryNode>, AppError> {
    let manifest = match std::fs::read_to_string(manifest_path(dir)) {
        Ok(s) => {
            serde_json::from_str::<Vec<ManifestEntry>>(&s).map_err(|e| AppError::Parse(e.to_string()))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AppError::Io(e.to_string())),
    };
    manifest
        .into_iter()
        .map(|entry| match entry {
            ManifestEntry::Folder { id, parent_id, name } => Ok(QueryNode::Folder { id, parent_id, name }),
            ManifestEntry::Query { id, parent_id, name, updated_at } => {
                let content = read_query_content(dir, id)?;
                Ok(QueryNode::Query {
                    id,
                    parent_id,
                    name,
                    statement: content.statement,
                    db: content.db,
                    updated_at,
                })
            }
        })
        .collect()
}

/// Writes `manifest.json` plus one `<id>.json` per query node; stale per-id files for nodes no
/// longer present (deleted queries) are removed so they don't leave orphaned content behind.
pub fn save(dir: &Path, nodes: &[QueryNode]) -> Result<(), AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;

    let live_ids: HashSet<u32> = nodes.iter().map(QueryNode::id).collect();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            if stem == "manifest" || path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(id) = stem.parse::<u32>() {
                if !live_ids.contains(&id) {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    for n in nodes {
        if let QueryNode::Query { id, statement, db, .. } = n {
            let content = QueryContent { statement: statement.clone(), db: db.clone() };
            let json =
                serde_json::to_string_pretty(&content).map_err(|e| AppError::Serialize(e.to_string()))?;
            std::fs::write(query_file_path(dir, *id), json).map_err(|e| AppError::Io(e.to_string()))?;
        }
    }

    let manifest: Vec<ManifestEntry> = nodes
        .iter()
        .map(|n| match n {
            QueryNode::Folder { id, parent_id, name } => {
                ManifestEntry::Folder { id: *id, parent_id: *parent_id, name: name.clone() }
            }
            QueryNode::Query { id, parent_id, name, updated_at, .. } => {
                ManifestEntry::Query { id: *id, parent_id: *parent_id, name: name.clone(), updated_at: *updated_at }
            }
        })
        .collect();
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| AppError::Serialize(e.to_string()))?;
    std::fs::write(manifest_path(dir), manifest_json).map_err(|e| AppError::Io(e.to_string()))
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

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir("monglumio_test_qlib_roundtrip");
        let nodes = vec![folder(1, None, "Reports"), query(2, Some(1), "Active users")];
        save(&dir, &nodes).unwrap();
        assert_eq!(load(&dir).unwrap(), nodes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_writes_manifest_and_one_file_per_query() {
        let dir = temp_dir("monglumio_test_qlib_files");
        let nodes = vec![folder(1, None, "Reports"), query(2, Some(1), "Active users"), query(3, Some(1), "Inactive")];
        save(&dir, &nodes).unwrap();
        assert!(dir.join("manifest.json").exists());
        assert!(dir.join("2.json").exists());
        assert!(dir.join("3.json").exists());
        // Folder nodes never get a content file.
        assert!(!dir.join("1.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manifest_never_stores_the_statement_text() {
        let dir = temp_dir("monglumio_test_qlib_manifest_shape");
        save(&dir, &[query(2, None, "q")]).unwrap();
        let manifest = std::fs::read_to_string(dir.join("manifest.json")).unwrap();
        assert!(!manifest.contains("db.users.find()"));
        let content = std::fs::read_to_string(dir.join("2.json")).unwrap();
        assert!(content.contains("db.users.find()"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_query_removes_its_orphaned_file() {
        let dir = temp_dir("monglumio_test_qlib_orphan");
        save(&dir, &[query(2, None, "a"), query(3, None, "b")]).unwrap();
        assert!(dir.join("3.json").exists());
        save(&dir, &[query(2, None, "a")]).unwrap();
        assert!(!dir.join("3.json").exists());
        assert!(dir.join("2.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_manifest_is_empty() {
        let dir = temp_dir("monglumio_test_qlib_missing");
        assert_eq!(load(&dir).unwrap(), Vec::<QueryNode>::new());
    }

    #[test]
    fn load_malformed_manifest_is_parse_error() {
        let dir = temp_dir("monglumio_test_qlib_malformed");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(manifest_path(&dir), "{not json").unwrap();
        assert!(matches!(load(&dir), Err(AppError::Parse(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_with_a_missing_query_content_file_is_an_error() {
        let dir = temp_dir("monglumio_test_qlib_missing_content");
        save(&dir, &[query(2, None, "a")]).unwrap();
        std::fs::remove_file(dir.join("2.json")).unwrap();
        assert!(load(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_legacy_splits_the_old_single_file_and_backs_it_up() {
        let dir = temp_dir("monglumio_test_qlib_migrate");
        std::fs::create_dir_all(&dir).unwrap();
        let legacy_path = dir.join("query_library.json");
        let legacy_nodes = vec![folder(1, None, "Reports"), query(2, Some(1), "Active users")];
        std::fs::write(&legacy_path, serde_json::to_string(&legacy_nodes).unwrap()).unwrap();
        let new_dir = dir.join("saved_queries");

        migrate_legacy(&legacy_path, &new_dir).unwrap();

        assert!(!legacy_path.exists());
        assert!(dir.join("query_library.json.bak").exists());
        assert_eq!(load(&new_dir).unwrap(), legacy_nodes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_legacy_is_a_noop_once_the_manifest_already_exists() {
        let dir = temp_dir("monglumio_test_qlib_migrate_noop");
        std::fs::create_dir_all(&dir).unwrap();
        let legacy_path = dir.join("query_library.json");
        std::fs::write(&legacy_path, serde_json::to_string(&vec![folder(9, None, "stale")]).unwrap()).unwrap();
        let new_dir = dir.join("saved_queries");
        save(&new_dir, &[folder(1, None, "current")]).unwrap();

        migrate_legacy(&legacy_path, &new_dir).unwrap();

        // Legacy file untouched, current manifest untouched — migration never ran.
        assert!(legacy_path.exists());
        assert_eq!(load(&new_dir).unwrap(), vec![folder(1, None, "current")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_legacy_is_a_noop_when_there_is_no_legacy_file() {
        let dir = temp_dir("monglumio_test_qlib_migrate_nothing");
        let legacy_path = dir.join("query_library.json");
        let new_dir = dir.join("saved_queries");
        migrate_legacy(&legacy_path, &new_dir).unwrap();
        assert_eq!(load(&new_dir).unwrap(), Vec::<QueryNode>::new());
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
