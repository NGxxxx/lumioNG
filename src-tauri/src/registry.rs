use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: u32,
    pub label: String,
    pub uri: String,
}

/// `id` None → thêm mới (gán max(id)+1, list rỗng → 1). `id` khớp → cập nhật label+uri.
/// `id` không khớp phần tử nào → list giữ nguyên.
pub fn upsert(
    mut list: Vec<SavedConnection>,
    id: Option<u32>,
    label: String,
    uri: String,
) -> Vec<SavedConnection> {
    match id {
        Some(id) => {
            if let Some(c) = list.iter_mut().find(|c| c.id == id) {
                c.label = label;
                c.uri = uri;
            }
            list
        }
        None => {
            let next = list.iter().map(|c| c.id).max().map_or(1, |m| m + 1);
            list.push(SavedConnection { id: next, label, uri });
            list
        }
    }
}

pub fn remove(list: Vec<SavedConnection>, id: u32) -> Vec<SavedConnection> {
    list.into_iter().filter(|c| c.id != id).collect()
}

/// File thiếu → Ok(vec![]); JSON hỏng → Parse; lỗi đọc khác → Io.
pub fn load(path: &Path) -> Result<Vec<SavedConnection>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn save(path: &Path, list: &[SavedConnection]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(list).map_err(|e| AppError::Serialize(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(id: u32, label: &str, uri: &str) -> SavedConnection {
        SavedConnection { id, label: label.into(), uri: uri.into() }
    }

    #[test]
    fn upsert_new_on_empty_gets_id_1() {
        let out = upsert(vec![], None, "Local".into(), "mongodb://localhost".into());
        assert_eq!(out, vec![conn(1, "Local", "mongodb://localhost")]);
    }

    #[test]
    fn upsert_new_gets_max_id_plus_1() {
        let list = vec![conn(1, "a", "mongodb://a"), conn(4, "b", "mongodb://b")];
        let out = upsert(list, None, "c".into(), "mongodb://c".into());
        assert_eq!(out.last().unwrap().id, 5);
    }

    #[test]
    fn upsert_existing_updates_keeps_id() {
        let list = vec![conn(2, "old", "mongodb://old")];
        let out = upsert(list, Some(2), "new".into(), "mongodb://new".into());
        assert_eq!(out, vec![conn(2, "new", "mongodb://new")]);
    }

    #[test]
    fn upsert_unknown_id_is_noop() {
        let list = vec![conn(1, "a", "mongodb://a")];
        let out = upsert(list.clone(), Some(99), "x".into(), "mongodb://x".into());
        assert_eq!(out, list);
    }

    #[test]
    fn remove_drops_matching_id() {
        let list = vec![conn(1, "a", "mongodb://a"), conn(2, "b", "mongodb://b")];
        assert_eq!(remove(list, 1), vec![conn(2, "b", "mongodb://b")]);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_roundtrip");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        let list = vec![conn(1, "Local", "mongodb://localhost:27017")];
        save(&path, &list).unwrap();
        assert_eq!(load(&path).unwrap(), list);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_empty() {
        let path = std::env::temp_dir().join("monglumio_test_registry_missing/nope.json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert_eq!(load(&path).unwrap(), Vec::<SavedConnection>::new());
    }
}
