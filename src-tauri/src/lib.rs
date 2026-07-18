// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod bson_json;
mod commands;
mod csv_import;
mod error;
mod json_bson;
mod query_library;
mod registry;
mod script;
mod sql_import;
mod ssh_tunnel;
mod state;
mod value_infer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::test_connection,
            commands::connection::list_namespaces,
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::touch_connection,
            commands::connection::disconnect,
            commands::query::query_page,
            commands::query::aggregate,
            commands::query::aggregate_count,
            commands::query::sample_documents,
            commands::query::count_documents,
            commands::query::distinct,
            commands::query::explain_find,
            commands::query::explain_aggregate,
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
            commands::import_export::import_file_size,
            commands::sql::sql_import_preview,
            commands::sql::sql_import_commit,
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
            commands::index::drop_index,
            commands::stats::coll_stats,
            commands::stats::db_stats,
            commands::stats::coll_options,
            commands::server::server_status,
            commands::server::build_info,
            commands::server::host_info,
            commands::server::current_ops,
            commands::server::kill_op,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
