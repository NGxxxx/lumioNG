use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use tauri::State;

#[tauri::command]
pub async fn create_collection(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client.database(&db).create_collection(&coll).await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_collection(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client
        .database(&db)
        .collection::<Document>(&coll)
        .drop()
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn duplicate_collection(
    session_id: String,
    db: String,
    source: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let database = client.database(&db);
    // `$out` silently overwrites an existing target collection, so reject up front instead.
    if database.list_collection_names().await?.iter().any(|n| n == &target) {
        return Err(AppError::Query(format!("collection \"{target}\" already exists")));
    }
    // $out copies documents only (not indexes); draining the empty cursor it returns surfaces any pipeline error.
    let mut cursor = database
        .collection::<Document>(&source)
        .aggregate(vec![doc! { "$out": &target }])
        .await?;
    while cursor.try_next().await?.is_some() {}
    Ok(())
}

#[tauri::command]
pub async fn rename_collection(
    session_id: String,
    db: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    // renameCollection must run against the "admin" db; renames within the same DB only.
    client
        .database("admin")
        .run_command(doc! {
            "renameCollection": format!("{db}.{from}"),
            "to": format!("{db}.{to}"),
            "dropTarget": false,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_database(
    session_id: String,
    db: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client.database(&db).drop().await?;
    Ok(())
}

/// Sets (or clears, with `validator_json: "{}"`) a collection's JSON-schema validator via `collMod`.
#[tauri::command]
pub async fn set_collection_validator(
    session_id: String,
    db: String,
    coll: String,
    validator_json: String,
    validation_level: String,
    validation_action: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let validator = canonical_string_to_doc(&validator_json)?;
    client
        .database(&db)
        .run_command(doc! {
            "collMod": &coll,
            "validator": validator,
            "validationLevel": validation_level,
            "validationAction": validation_action,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn truncate_collection(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let res = client
        .database(&db)
        .collection::<Document>(&coll)
        .delete_many(doc! {})
        .await?;
    Ok(res.deleted_count)
}
