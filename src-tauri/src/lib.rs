// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod bson_json;
mod commands;
mod error;
mod json_bson;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::list_namespaces,
            commands::documents::query_page,
            commands::documents::insert_document,
            commands::documents::replace_document,
            commands::documents::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
