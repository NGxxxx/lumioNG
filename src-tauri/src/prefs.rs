//! UI preferences (`prefs.json` in the config dir): a flat string -> string map the frontend reads once at startup.
//! Writes are atomic (temp file + rename); an unreadable file is set aside and loads as empty.
use crate::error::AppError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type Prefs = HashMap<String, String>;

const FILE: &str = "prefs.json";
/// An imported file larger than this is not a settings file.
const MAX_IMPORT_BYTES: u64 = 32 * 1024 * 1024;
/// Keys that never travel through export/import: every `mcp-*` key (bearer token, enabled, port, write flag)
/// every `audit-*` key (which environments are audited) and every `workspace-*` key (the restore snapshot holds
/// query/filter text and machine-local connection ids).
/// A settings file must neither leak the token nor be able to turn the MCP server or its write access on,
/// and must not be able to switch auditing off for production.
const EXCLUDED_PREFIXES: [&str; 3] = ["mcp-", "audit-", "workspace-"];

fn is_excluded(key: &str) -> bool {
    EXCLUDED_PREFIXES.iter().any(|p| key.starts_with(p))
}

fn io(e: impl std::fmt::Display) -> AppError {
    AppError::Io(e.to_string())
}

pub fn prefs_path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Writes `bytes` to `path` via `<path>.tmp` + rename, so a crash never leaves a half-written file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        io(e)
    })
}

/// Loads the prefs; a missing file is empty. A corrupt file is renamed to `prefs.json.corrupt-<epoch_ms>` and loads empty.
pub fn load(dir: &Path) -> Prefs {
    let path = prefs_path(dir);
    let Ok(text) = std::fs::read_to_string(&path) else {
        if path.exists() {
            back_up_corrupt(&path);
        }
        return Prefs::new();
    };
    match serde_json::from_str::<Prefs>(&text) {
        Ok(map) => map,
        Err(e) => {
            tracing::warn!("prefs.json is corrupt ({e}); starting empty");
            back_up_corrupt(&path);
            Prefs::new()
        }
    }
}

fn back_up_corrupt(path: &Path) {
    let mut backup = path.as_os_str().to_owned();
    backup.push(format!(".corrupt-{}", now_ms()));
    if let Err(e) = std::fs::rename(path, PathBuf::from(backup)) {
        tracing::warn!("could not back up corrupt prefs.json: {e}");
    }
}

pub fn save(dir: &Path, entries: &Prefs) -> Result<(), AppError> {
    atomic_write(&prefs_path(dir), &serialize(entries)?)
}

fn serialize(entries: &Prefs) -> Result<Vec<u8>, AppError> {
    // BTreeMap-style ordering keeps the file diff-friendly.
    let sorted: std::collections::BTreeMap<_, _> = entries.iter().collect();
    serde_json::to_vec_pretty(&sorted).map_err(|e| AppError::Serialize(e.to_string()))
}

/// Writes the stored prefs (minus secrets) to `path`.
pub fn export(dir: &Path, path: &Path) -> Result<(), AppError> {
    let mut entries = load(dir);
    entries.retain(|k, _| !is_excluded(k));
    std::fs::write(path, serialize(&entries)?).map_err(io)
}

/// Reads a settings file produced by `export`, dropping excluded keys. Does not touch the stored prefs.
pub fn read_import(path: &Path) -> Result<Prefs, AppError> {
    let len = std::fs::metadata(path).map_err(io)?.len();
    if len > MAX_IMPORT_BYTES {
        return Err(AppError::Parse("settings file is too large".into()));
    }
    let text = std::fs::read_to_string(path).map_err(io)?;
    let mut entries = serde_json::from_str::<Prefs>(&text).map_err(|e| AppError::Parse(format!("not a settings file: {e}")))?;
    entries.retain(|k, _| !is_excluded(k));
    Ok(entries)
}

/// The prefs to adopt from an imported file: its allowed keys plus the CURRENT values of the excluded ones.
pub fn import(dir: &Path, path: &Path) -> Result<Prefs, AppError> {
    let mut entries = read_import(path)?;
    entries.extend(load(dir).into_iter().filter(|(k, _)| is_excluded(k)));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn map(pairs: &[(&str, &str)]) -> Prefs {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn atomic_write_survives_existing_file() {
        let dir = temp_dir("lumiong_test_prefs_atomic");
        save(&dir, &map(&[("theme", "latte")])).unwrap();
        save(&dir, &map(&[("theme", "mocha"), ("ui-size", "large")])).unwrap();
        assert_eq!(load(&dir), map(&[("theme", "mocha"), ("ui-size", "large")]));
        assert!(!dir.join("prefs.json.tmp").exists(), "temp file must be renamed away");
    }

    #[test]
    fn corrupt_file_loads_empty_and_is_backed_up() {
        let dir = temp_dir("lumiong_test_prefs_corrupt");
        std::fs::write(prefs_path(&dir), "{ not json").unwrap();
        assert!(load(&dir).is_empty());
        assert!(!prefs_path(&dir).exists());
        let backups: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("prefs.json.corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read_to_string(backups[0].path()).unwrap(), "{ not json");
    }

    #[test]
    fn missing_file_loads_empty_without_backup() {
        let dir = temp_dir("lumiong_test_prefs_missing");
        assert!(load(&dir).is_empty());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    }

    #[test]
    fn non_string_values_count_as_corrupt() {
        let dir = temp_dir("lumiong_test_prefs_nonstring");
        std::fs::write(prefs_path(&dir), r#"{"a": 1}"#).unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn export_omits_mcp_keys_and_import_reads_the_rest() {
        let dir = temp_dir("lumiong_test_prefs_export");
        save(&dir, &map(&[("theme", "latte"), ("mcp-token", "secret"), ("mcp-port", "1")])).unwrap();
        let out = dir.join("out.json");
        export(&dir, &out).unwrap();
        assert_eq!(read_import(&out).unwrap(), map(&[("theme", "latte")]));
    }

    #[test]
    fn import_drops_mcp_keys_and_keeps_current_ones() {
        let dir = temp_dir("lumiong_test_prefs_import_mcp");
        save(&dir, &map(&[("mcp-token", "mine"), ("mcp-enabled", "false"), ("theme", "mocha")])).unwrap();
        let file = dir.join("in.json");
        std::fs::write(&file, r#"{"mcp-token":"evil","mcp-allow-writes":"true","mcp-enabled":"true","theme":"latte"}"#).unwrap();
        assert_eq!(read_import(&file).unwrap(), map(&[("theme", "latte")]));
        let merged = import(&dir, &file).unwrap();
        assert_eq!(merged, map(&[("mcp-token", "mine"), ("mcp-enabled", "false"), ("theme", "latte")]));
        assert!(!merged.contains_key("mcp-allow-writes"));
    }

    #[test]
    fn workspace_snapshot_is_excluded_from_export() {
        let dir = temp_dir("lumiong_test_prefs_workspace_export");
        save(&dir, &map(&[("workspace-snapshot", "{\"tabs\":[]}"), ("theme", "latte")])).unwrap();
        let out = dir.join("out.json");
        export(&dir, &out).unwrap();
        assert_eq!(read_import(&out).unwrap(), map(&[("theme", "latte")]));
    }

    #[test]
    fn import_keeps_the_local_workspace_snapshot() {
        let dir = temp_dir("lumiong_test_prefs_workspace_import");
        save(&dir, &map(&[("workspace-snapshot", "mine"), ("theme", "mocha")])).unwrap();
        let file = dir.join("in.json");
        std::fs::write(&file, r#"{"workspace-snapshot":"theirs","workspace-other":"x","theme":"latte"}"#).unwrap();
        assert_eq!(read_import(&file).unwrap(), map(&[("theme", "latte")]));
        let merged = import(&dir, &file).unwrap();
        assert_eq!(merged, map(&[("workspace-snapshot", "mine"), ("theme", "latte")]));
    }

    #[test]
    fn audit_keys_are_excluded_from_export_and_import_keeps_current_value() {
        let dir = temp_dir("lumiong_test_prefs_audit_scope");
        save(&dir, &map(&[("audit-scope", "all"), ("theme", "mocha")])).unwrap();
        let out = dir.join("out.json");
        export(&dir, &out).unwrap();
        assert_eq!(read_import(&out).unwrap(), map(&[("theme", "mocha")]));
        // a file that tries to narrow auditing back to nothing/prod cannot change the current choice
        let file = dir.join("in.json");
        std::fs::write(&file, r#"{"audit-scope":"prod","audit-other":"x","theme":"latte"}"#).unwrap();
        assert_eq!(read_import(&file).unwrap(), map(&[("theme", "latte")]));
        assert_eq!(import(&dir, &file).unwrap(), map(&[("audit-scope", "all"), ("theme", "latte")]));
    }

    #[test]
    fn import_rejects_non_settings_files() {
        let dir = temp_dir("lumiong_test_prefs_import_bad");
        let bad = dir.join("bad.json");
        std::fs::write(&bad, "[1,2]").unwrap();
        assert!(read_import(&bad).is_err());
        assert!(read_import(&dir.join("absent.json")).is_err());
    }
}
