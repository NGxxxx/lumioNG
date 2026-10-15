use serde::Serialize;

/// What the About dialog shows (and copies into a bug report).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub commit: String,
    pub build_date: String,
    pub os: String,
    pub arch: String,
    /// WebView2 / WebKitGTK / WKWebView version; None when the runtime can't report it.
    pub webview: Option<String>,
}

fn build_info(webview: Option<String>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        commit: env!("LUMIO_COMMIT").into(),
        build_date: env!("LUMIO_BUILD_DATE").into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        webview,
    }
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    build_info(tauri::webview_version().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_info_carries_build_metadata() {
        let i = build_info(Some("130.0".into()));
        assert_eq!(i.version, env!("CARGO_PKG_VERSION"));
        assert!(!i.commit.is_empty());
        assert_eq!(i.build_date.len(), 10);
        assert_eq!(i.os, std::env::consts::OS);
        let json = serde_json::to_value(&i).unwrap();
        assert_eq!(json["buildDate"], i.build_date);
        assert_eq!(json["webview"], "130.0");
    }
}
