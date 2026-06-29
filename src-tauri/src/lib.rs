// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod bson_json;
mod commands;
mod error;
mod json_bson;
mod registry;
mod script;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::list_namespaces,
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::disconnect,
            commands::query::query_page,
            commands::query::aggregate,
            commands::query::sample_documents,
            commands::query::count_documents,
            commands::query::distinct,
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
            commands::import_export::import_documents,
            commands::import_export::export_json_progress,
            commands::import_export::export_bson_progress,
            commands::import_export::export_query_progress,
            commands::import_export::import_bson,
            commands::admin::create_collection,
            commands::admin::drop_collection,
            commands::admin::rename_collection,
            commands::admin::duplicate_collection,
            commands::admin::drop_database,
            commands::admin::truncate_collection,
            commands::index::list_indexes,
            commands::index::create_index,
            commands::index::drop_index,
            commands::stats::coll_stats,
            commands::stats::db_stats,
            commands::stats::coll_options,
            commands::server::server_status,
            commands::server::build_info,
            commands::server::host_info,
            commands::script::run_script,
            commands::script::cancel_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
