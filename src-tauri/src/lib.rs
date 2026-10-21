// Tauri commands take every IPC argument as its own parameter.
#![allow(clippy::too_many_arguments)]
// Tests use literals like 3.14 as ordinary sample values, not as approximations of PI.
#![cfg_attr(test, allow(clippy::approx_constant))]
mod atlas;
mod audit;
mod bson_import;
mod bson_json;
mod command_log_file;
mod commands;
mod compare;
mod csfle;
#[cfg(feature = "csfle")]
mod csfle_engine;
mod csv_export;
mod csv_import;
mod error;
mod json_bson;
mod json_import;
mod json_stream;
mod http_client;
mod http_proxy_tunnel;
mod known_hosts;
mod logging;
mod mcp;
mod oidc_human;
mod prefs;
mod proxy;
mod query_library;
mod redact;
mod registry;
mod script;
mod secrets;
mod sql_export;
mod sql_import;
mod sql_stream;
mod ssh_tunnel;
mod state;
mod value_infer;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .manage(vault::VaultSession::default())
        .manage(commands::atlas::AtlasState::default())
        .manage(commands::command_log::CommandLogFile::default())
        .manage(commands::mcp::McpServer::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Remembers size, position and maximized state (saved on close/exit, restored when the window is
        // created; a saved position that no monitor shows any more is ignored by the plugin). Decorations are
        // left out on purpose: the "system window frame" option owns them (see TitleBar / windowFrame store).
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            // First run (no saved window state yet): start maximized, as tauri.conf.json used to force.
            // The config no longer sets `maximized`, because the plugin cannot un-maximize a window.
            let first_run = app
                .path()
                .app_config_dir()
                .map(|d| !d.join(".window-state.json").exists())
                .unwrap_or(true);
            if first_run {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.maximize();
                }
            }
            // Logging is best-effort: the app runs fine without a writable log directory.
            if let Ok(dir) = app.path().app_log_dir() {
                logging::init(dir);
            }
            // The audit log needs a writable data dir; without one, records are dropped (and the write still happens).
            if let Ok(dir) = app.path().app_data_dir() {
                app.state::<state::AppState>().audit.set_dir(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::test_connection,
            commands::diagnose::diagnose_connection,
            commands::connection::session_ping,
            commands::connection::set_session_meta,
            commands::app::app_info,
            commands::connection::list_namespaces,
            commands::connection::list_plain_collections,
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::touch_connection,
            commands::connection::secret_storage,
            commands::connection::vault_status,
            commands::connection::vault_unlock,
            commands::connection::vault_setup,
            commands::connection::vault_reset,
            commands::connection::disconnect,
            commands::connection::forget_ssh_host_key,
            commands::query::query_page,
            commands::query::aggregate,
            commands::query::aggregate_count,
            commands::query::sample_documents,
            commands::query::count_documents,
            commands::query::distinct,
            commands::query::explain_find,
            commands::query::explain_aggregate,
            commands::query::find_by_id,
            commands::query::find_raw_by_ids,
            commands::mutation::insert_document,
            commands::mutation::replace_document,
            commands::mutation::delete_document,
            commands::mutation::update_many,
            commands::mutation::delete_many,
            commands::mutation::insert_many,
            commands::mutation::update_one,
            commands::mutation::replace_one,
            commands::mutation::delete_one,
            commands::import_export::write_text_file,
            commands::import_export::write_base64_file,
            commands::import_export::read_text_file_if_exists,
            commands::import_export::import_documents,
            commands::import_export::export_json_progress,
            commands::import_export::export_bson_progress,
            commands::import_export::export_csv_progress,
            commands::import_export::export_sql_progress,
            commands::import_export::export_query_progress,
            commands::import_export::cancel_export,
            commands::compare::compare_start,
            commands::compare::compare_page,
            commands::compare::compare_dispose,
            commands::compare::compare_cancel,
            commands::compare::sync_apply,
            commands::gridfs::gridfs_preview_bytes,
            commands::gridfs::gridfs_download,
            commands::import_export::import_bson,
            commands::import_export::import_file_size,
            commands::sql::sql_import_preview,
            commands::sql::sql_import_commit,
            commands::sql::cancel_import,
            commands::csv::csv_import_preview,
            commands::csv::csv_import_commit,
            commands::admin::create_collection,
            commands::admin::drop_collection,
            commands::admin::rename_collection,
            commands::admin::duplicate_collection,
            commands::admin::drop_database,
            commands::admin::truncate_collection,
            commands::admin::set_collection_validator,
            commands::index::list_indexes,
            commands::index::create_index,
            commands::index::create_indexes_raw,
            commands::index::drop_index,
            commands::index::index_stats,
            commands::index::set_index_hidden,
            commands::stats::coll_stats,
            commands::stats::db_stats,
            commands::stats::coll_options,
            commands::csfle::csfle_available,
            commands::csfle::csfle_get,
            commands::csfle::csfle_save,
            commands::csfle::csfle_clear,
            commands::csfle::csfle_generate_local_key,
            commands::csfle::csfle_session_enabled,
            commands::csfle::csfle_encrypted_paths,
            commands::csfle::csfle_list_keys,
            commands::csfle::csfle_create_data_key,
            commands::csfle::csfle_encrypt,
            commands::atlas::atlas_has_credentials,
            commands::atlas::atlas_save_credentials,
            commands::atlas::atlas_forget_credentials,
            commands::atlas::atlas_list_projects,
            commands::atlas::atlas_list_clusters,
            commands::search_index::atlas_version,
            commands::search_index::list_search_indexes,
            commands::search_index::create_search_index,
            commands::search_index::update_search_index,
            commands::search_index::drop_search_index,
            commands::server::server_status,
            commands::server::build_info,
            commands::server::host_info,
            commands::server::current_ops,
            commands::server::kill_op,
            commands::server::is_master,
            commands::server::repl_set_status,
            commands::server::list_shards,
            commands::server::balancer_status,
            commands::server::server_metrics,
            commands::server::slow_ops,
            commands::server::profiler_status,
            commands::server::recent_slow_queries,
            commands::script::run_script,
            commands::script::cancel_script,
            commands::users::list_users,
            commands::users::create_user,
            commands::users::update_user_roles,
            commands::users::change_user_password,
            commands::users::drop_user,
            commands::users::list_roles,
            commands::users::create_role,
            commands::users::update_role,
            commands::users::drop_role,
            commands::query_library::load_query_library,
            commands::query_library::save_query_library,
            commands::command_log::command_log_append,
            commands::command_log::command_log_read,
            commands::command_log::command_log_dir,
            commands::command_log::command_log_clear,
            commands::watch::watch_start,
            commands::watch::watch_stop,
            commands::profiler::profile_watch_start,
            commands::mcp::mcp_start,
            commands::mcp::mcp_stop,
            commands::mcp::mcp_status,
            commands::mcp::mcp_set_sessions,
            commands::diagnostics::log_frontend,
            commands::diagnostics::export_diagnostics,
            commands::diagnostics::take_crash_reports,
            commands::diagnostics::open_crash_folder,
            commands::audit::audit_set_scope,
            commands::audit::audit_query,
            commands::audit::audit_verify,
            commands::audit::audit_export,
            commands::prefs::prefs_load,
            commands::prefs::prefs_save,
            commands::prefs::prefs_export,
            commands::prefs::prefs_import,
            #[cfg(debug_assertions)]
            commands::diagnostics::debug_panic,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
