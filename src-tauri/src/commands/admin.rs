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
    let client = state.writable_client(&session_id).await?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "create_collection", &format!("{db}.{coll}"), None, |_| None, async {
            Ok(client.database(&db).create_collection(&coll).await?)
        })
        .await
}

#[tauri::command]
pub async fn drop_collection(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "drop_collection", &format!("{db}.{coll}"), None, |_| None, async {
            Ok(client.database(&db).collection::<Document>(&coll).drop().await?)
        })
        .await
}

#[tauri::command]
pub async fn duplicate_collection(
    session_id: String,
    db: String,
    source: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    let database = client.database(&db);
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "duplicate_collection", &format!("{db}.{source} -> {db}.{target}"), None, |_| None, async {
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
        })
        .await
}

#[tauri::command]
pub async fn rename_collection(
    session_id: String,
    db: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    // renameCollection must run against the "admin" db; renames within the same DB only.
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "rename_collection", &format!("{db}.{from} -> {db}.{to}"), None, |_| None, async {
            client
                .database("admin")
                .run_command(doc! {
                    "renameCollection": format!("{db}.{from}"),
                    "to": format!("{db}.{to}"),
                    "dropTarget": false,
                })
                .await?;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn drop_database(
    session_id: String,
    db: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "drop_database", &db, None, |_| None, async {
            Ok(client.database(&db).drop().await?)
        })
        .await
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
    let client = state.writable_client(&session_id).await?;
    let validator = canonical_string_to_doc(&validator_json)?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "set_collection_validator", &format!("{db}.{coll}"), None, |_| None, async {
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
        })
        .await
}

#[tauri::command]
pub async fn truncate_collection(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.writable_client(&session_id).await?;
    let res = state
        .audited(&session_id, crate::audit::SOURCE_UI, "truncate_collection", &format!("{db}.{coll}"), None, |r| Some(r.deleted_count), async {
            Ok::<_, AppError>(client.database(&db).collection::<Document>(&coll).delete_many(doc! {}).await?)
        })
        .await?;
    Ok(res.deleted_count)
}
