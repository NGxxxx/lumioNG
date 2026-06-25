use crate::bson_json::bson_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_bson, canonical_string_to_doc};
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use tauri::State;

use super::query::parse_user_filter;

#[derive(serde::Serialize)]
pub struct BulkResult {
    pub matched: u64,
    pub modified: u64,
}

/// Reject a replacement whose embedded _id differs from the original (immutable _id).
fn ensure_id_unchanged(
    new_doc: &mongodb::bson::Document,
    id: &mongodb::bson::Bson,
) -> Result<(), AppError> {
    if let Some(new_id) = new_doc.get("_id") {
        if new_id != id {
            return Err(AppError::Query("cannot change _id".into()));
        }
    }
    Ok(())
}

/// Guard against destructive bulk operations on an empty filter unless explicitly confirmed.
pub(crate) fn ensure_filter_allowed(filter: &Document, allow_all: bool) -> Result<(), AppError> {
    if filter.is_empty() && !allow_all {
        return Err(AppError::Query(
            "empty filter: confirmation required to apply to the whole collection".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn insert_document(
    session_id: String,
    db: String,
    coll: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.insert_one(new_doc).await?;
    bson_to_canonical_string(&res.inserted_id)
}

#[tauri::command]
pub async fn replace_document(
    session_id: String,
    db: String,
    coll: String,
    id_json: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let id_bson = canonical_string_to_bson(&id_json)?;

    // _id is immutable: reject if the edited document carries a different _id.
    ensure_id_unchanged(&new_doc, &id_bson)?;

    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection
        .replace_one(doc! { "_id": id_bson }, new_doc)
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::Query("document no longer exists".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    session_id: String,
    db: String,
    coll: String,
    id_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;

    let id_bson = canonical_string_to_bson(&id_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.delete_one(doc! { "_id": id_bson }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::Query("no document found to delete".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn update_many(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    update: String,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<BulkResult, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    ensure_filter_allowed(&f, allow_all)?;
    let update_doc = canonical_string_to_doc(&update)?;
    let res = collection.update_many(f, update_doc).await?;
    Ok(BulkResult {
        matched: res.matched_count,
        modified: res.modified_count,
    })
}

#[tauri::command]
pub async fn delete_many(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    ensure_filter_allowed(&f, allow_all)?;
    let res = collection.delete_many(f).await?;
    Ok(res.deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use mongodb::bson::{doc, oid::ObjectId, Bson};

    #[test]
    fn matching_id_is_ok() {
        let oid = ObjectId::new();
        let id = Bson::ObjectId(oid);
        let new_doc = doc! { "_id": oid, "name": "alice" };
        assert!(ensure_id_unchanged(&new_doc, &id).is_ok());
    }

    #[test]
    fn different_id_is_rejected() {
        let id = Bson::ObjectId(ObjectId::new());
        let new_doc = doc! { "_id": ObjectId::new(), "name": "alice" };
        let res = ensure_id_unchanged(&new_doc, &id);
        assert!(matches!(res, Err(AppError::Query(_))));
    }

    #[test]
    fn omitted_id_is_ok() {
        let id = Bson::ObjectId(ObjectId::new());
        let new_doc = doc! { "name": "alice" };
        assert!(ensure_id_unchanged(&new_doc, &id).is_ok());
    }

    #[test]
    fn empty_filter_without_allow_is_rejected() {
        let res = ensure_filter_allowed(&Document::new(), false);
        assert!(matches!(res, Err(AppError::Query(_))));
    }

    #[test]
    fn empty_filter_with_allow_is_ok() {
        assert!(ensure_filter_allowed(&Document::new(), true).is_ok());
    }

    #[test]
    fn non_empty_filter_is_ok_without_allow() {
        let f = doc! { "status": "active" };
        assert!(ensure_filter_allowed(&f, false).is_ok());
    }
}
