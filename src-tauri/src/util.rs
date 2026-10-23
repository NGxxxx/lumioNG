//! Small helpers shared across modules.
use crate::error::AppError;
use std::sync::{Mutex, MutexGuard};

/// `Mutex::lock` that recovers the guard from a poisoned lock. Use it only where every critical
/// section leaves no half-updated invariant behind (a single assignment, push, drain...), so a panic
/// elsewhere must not permanently wedge the state with `unwrap()` panics.
pub(crate) fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Milliseconds since the Unix epoch (0 if the clock is before it).
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Runs blocking work (file I/O, hashing, key derivation, OS keychain calls) on tokio's blocking pool,
/// so neither the async runtime nor Tauri's main thread stalls on it.
pub(crate) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, AppError> + Send + 'static) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::Io(e.to_string()))?
}

/// The app's config directory (`connections.json`, `prefs.json`, saved queries...).
pub(crate) fn config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    use tauri::Manager;
    app.path().app_config_dir().map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_poisoned_lock_is_recovered() {
        let m = std::sync::Arc::new(Mutex::new(1));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("poison");
        })
        .join();
        assert!(m.is_poisoned());
        *lock_recover(&m) += 1;
        assert_eq!(*lock_recover(&m), 2);
    }

    #[test]
    fn now_ms_is_after_2020() {
        assert!(now_ms() > 1_577_836_800_000);
    }
}
