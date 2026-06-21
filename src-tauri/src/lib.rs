// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod bson_json;
mod commands;
mod error;
mod json_bson;
mod registry;
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
            commands::documents::query_page,
            commands::documents::sample_documents,
            commands::documents::insert_document,
            commands::documents::replace_document,
            commands::documents::delete_document,
            commands::documents::count_documents,
            commands::documents::update_many,
            commands::documents::delete_many,
            commands::documents::export_query,
            commands::documents::write_text_file,
            commands::documents::import_documents,
            commands::documents::export_bson,
            commands::documents::import_bson,
            commands::admin::create_collection,
            commands::admin::drop_collection,
            commands::admin::rename_collection,
            commands::admin::drop_database,
            commands::admin::truncate_collection,
            commands::index::list_indexes,
            commands::index::create_index,
            commands::index::drop_index,
            commands::stats::coll_stats,
            commands::stats::db_stats,
            commands::stats::coll_options,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
