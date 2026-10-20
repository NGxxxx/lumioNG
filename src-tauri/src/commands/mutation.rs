use crate::bson_json::bson_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_bson, canonical_string_to_doc, canonical_string_to_doc_array};
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use mongodb::Collection;
use tauri::State;

use super::query::parse_user_filter;

#[derive(serde::Serialize)]
pub struct BulkResult {
    pub matched: u64,
    pub modified: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertManyResult {
    pub inserted_count: u64,
    pub inserted_ids: Vec<String>,
}

/// Runs one UI write and records it in the audit log (source `ui`, namespace `db.coll`).
async fn audited<T>(
    state: &AppState,
    session_id: &str,
    op: &str,
    db: &str,
    coll: &str,
    filter: Option<&Document>,
    count: impl FnOnce(&T) -> Option<u64>,
    fut: impl std::future::Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    state.audited(session_id, crate::audit::SOURCE_UI, op, &format!("{db}.{coll}"), filter, count, fut).await
}

/// Parse a Canonical Extended JSON **array** of documents into Vec<Document>.
fn parse_doc_array(json: &str) -> Result<Vec<Document>, AppError> {
    canonical_string_to_doc_array(
        json,
        "insertMany expects an array of documents",
        "each element must be a document",
    )
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

/// Shared prefix of every bulk-write command: fetch the client, enforce the read-only guard,
/// resolve the target collection, and parse+gate the user filter.
async fn resolve_write_target(
    state: &AppState,
    session_id: &str,
    db: &str,
    coll: &str,
    filter: Option<&str>,
    allow_all: bool,
) -> Result<(Collection<Document>, Document), AppError> {
    let client = state.writable_client(session_id).await?;
    let collection = client.database(db).collection::<Document>(coll);
    let f = parse_user_filter(filter)?;
    ensure_filter_allowed(&f, allow_all)?;
    Ok((collection, f))
}

#[tauri::command]
pub async fn insert_document(
    session_id: String,
    db: String,
    coll: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.writable_client(&session_id).await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = audited(&state, &session_id, "insert_document", &db, &coll, None, |_| Some(1), async {
        Ok(collection.insert_one(new_doc).await?)
    })
    .await?;
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
    let client = state.writable_client(&session_id).await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let id_bson = canonical_string_to_bson(&id_json)?;

    // _id is immutable: reject if the edited document carries a different _id.
    ensure_id_unchanged(&new_doc, &id_bson)?;

    let collection = client.database(&db).collection::<Document>(&coll);
    let filter = doc! { "_id": id_bson };
    audited(&state, &session_id, "replace_document", &db, &coll, Some(&filter), |_| Some(1), async {
        let res = collection.replace_one(filter.clone(), new_doc).await?;
        if res.matched_count == 0 {
            return Err(AppError::Query("document no longer exists".into()));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_document(
    session_id: String,
    db: String,
    coll: String,
    id_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;

    let id_bson = canonical_string_to_bson(&id_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let filter = doc! { "_id": id_bson };
    audited(&state, &session_id, "delete_document", &db, &coll, Some(&filter), |_| Some(1), async {
        let res = collection.delete_one(filter.clone()).await?;
        if res.deleted_count == 0 {
            return Err(AppError::Query("no document found to delete".into()));
        }
        Ok(())
    })
    .await
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
    let (collection, f) =
        resolve_write_target(&state, &session_id, &db, &coll, filter.as_deref(), allow_all).await?;
    let update_doc = canonical_string_to_doc(&update)?;
    let res = audited(&state, &session_id, "update_many", &db, &coll, Some(&f), |r| Some(r.modified_count), async {
        Ok(collection.update_many(f.clone(), update_doc).await?)
    })
    .await?;
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
    let (collection, f) =
        resolve_write_target(&state, &session_id, &db, &coll, filter.as_deref(), allow_all).await?;
    let res = audited(&state, &session_id, "delete_many", &db, &coll, Some(&f), |r| Some(r.deleted_count), async {
        Ok(collection.delete_many(f.clone()).await?)
    })
    .await?;
    Ok(res.deleted_count)
}

#[tauri::command]
pub async fn insert_many(
    session_id: String,
    db: String,
    coll: String,
    docs_json: String,
    state: State<'_, AppState>,
) -> Result<InsertManyResult, AppError> {
    let client = state.writable_client(&session_id).await?;
    let docs = parse_doc_array(&docs_json)?;
    if docs.is_empty() {
        return Err(AppError::Query("insertMany requires at least one document".into()));
    }
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = audited(&state, &session_id, "insert_many", &db, &coll, None, |r| Some(r.inserted_ids.len() as u64), async {
        Ok(collection.insert_many(docs).await?)
    })
    .await?;
    // inserted_ids is a HashMap<usize, Bson>; restore insertion order by index.
    let mut entries: Vec<(usize, &mongodb::bson::Bson)> =
        res.inserted_ids.iter().map(|(k, v)| (*k, v)).collect();
    entries.sort_by_key(|(k, _)| *k);
    let inserted_ids = entries
        .into_iter()
        .map(|(_, b)| bson_to_canonical_string(b))
        .collect::<Result<Vec<String>, AppError>>()?;
    Ok(InsertManyResult {
        inserted_count: inserted_ids.len() as u64,
        inserted_ids,
    })
}

#[tauri::command]
pub async fn update_one(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    update: String,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<BulkResult, AppError> {
    let (collection, f) =
        resolve_write_target(&state, &session_id, &db, &coll, filter.as_deref(), allow_all).await?;
    let update_doc = canonical_string_to_doc(&update)?;
    let res = audited(&state, &session_id, "update_one", &db, &coll, Some(&f), |r| Some(r.modified_count), async {
        Ok(collection.update_one(f.clone(), update_doc).await?)
    })
    .await?;
    Ok(BulkResult {
        matched: res.matched_count,
        modified: res.modified_count,
    })
}

#[tauri::command]
pub async fn replace_one(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    replacement: String,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<BulkResult, AppError> {
    let (collection, f) =
        resolve_write_target(&state, &session_id, &db, &coll, filter.as_deref(), allow_all).await?;
    let repl = canonical_string_to_doc(&replacement)?;
    let res = audited(&state, &session_id, "replace_one", &db, &coll, Some(&f), |r| Some(r.modified_count), async {
        Ok(collection.replace_one(f.clone(), repl).await?)
    })
    .await?;
    Ok(BulkResult {
        matched: res.matched_count,
        modified: res.modified_count,
    })
}

#[tauri::command]
pub async fn delete_one(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let (collection, f) =
        resolve_write_target(&state, &session_id, &db, &coll, filter.as_deref(), allow_all).await?;
    let res = audited(&state, &session_id, "delete_one", &db, &coll, Some(&f), |r| Some(r.deleted_count), async {
        Ok(collection.delete_one(f.clone()).await?)
    })
    .await?;
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

    #[test]
    fn parse_doc_array_reads_documents() {
        let out = parse_doc_array(r#"[{"a":1},{"b":2}]"#).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].contains_key("a"));
    }

    #[test]
    fn parse_doc_array_rejects_non_array() {
        assert!(matches!(parse_doc_array(r#"{"a":1}"#), Err(AppError::Query(_))));
    }

    #[test]
    fn parse_doc_array_rejects_non_document_element() {
        assert!(matches!(parse_doc_array(r#"[1,2]"#), Err(AppError::Query(_))));
    }
}
