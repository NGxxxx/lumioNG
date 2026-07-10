use crate::error::AppError;
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
    // Copy every document into the new collection via `$out` (same DB). Server runs the
    // whole pipeline before returning an empty cursor; draining it surfaces any error.
    // Note: `$out` copies documents only, not indexes.
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
