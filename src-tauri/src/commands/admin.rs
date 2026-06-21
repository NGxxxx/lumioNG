use crate::error::AppError;
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use tauri::State;

#[tauri::command]
pub async fn create_collection(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;
    client.database(&db).create_collection(&coll).await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_collection(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;
    client
        .database(&db)
        .collection::<Document>(&coll)
        .drop()
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_collection(
    db: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;
    // renameCollection là lệnh chạy trên db "admin"; chỉ đổi tên trong cùng DB.
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
pub async fn drop_database(db: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let client = state.client().await?;
    client.database(&db).drop().await?;
    Ok(())
}

#[tauri::command]
pub async fn truncate_collection(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client().await?;
    let res = client
        .database(&db)
        .collection::<Document>(&coll)
        .delete_many(doc! {})
        .await?;
    Ok(res.deleted_count)
}
