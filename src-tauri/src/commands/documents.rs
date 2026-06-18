use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_bson, canonical_string_to_doc};
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Document};
use tauri::State;

/// Ghép filter người dùng với con trỏ keyset trên _id.
/// Không có con trỏ → trả filter nguyên vẹn; có → bọc trong `$and`
/// (an toàn kể cả khi filter tự nhắc tới `_id`).
fn build_query_filter(user: Document, after: Option<ObjectId>) -> Document {
    match after {
        None => user,
        Some(oid) => doc! { "$and": [ user, { "_id": { "$gt": oid } } ] },
    }
}

/// Dựng pipeline lấy mẫu schema, áp filter người dùng nếu có.
/// Filter rỗng → chỉ `$sample`; có filter → `$match` trước rồi `$sample`.
fn build_sample_pipeline(user: Document, size: i64) -> Vec<Document> {
    if user.is_empty() {
        vec![doc! { "$sample": { "size": size } }]
    } else {
        vec![doc! { "$match": user }, doc! { "$sample": { "size": size } }]
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_page(
    db: String,
    coll: String,
    after_id: Option<String>,   // keyset cursor (pristine: chưa filter, chưa sort)
    skip: Option<i64>,          // skip/limit cursor (đã filter hoặc đã sort)
    limit: i64,
    filter: Option<String>,
    sort: Option<String>,       // ExtJSON doc CÓ THỨ TỰ, vd {"age":-1,"_id":1}
    projection: Option<String>, // ExtJSON exclusion doc, vd {"big":0}
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = match filter.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => Document::new(),
    };

    let projection_doc = match projection.as_deref() {
        Some(s) if !s.trim().is_empty() => Some(canonical_string_to_doc(s)?),
        _ => None,
    };

    let mut cursor = if let Some(skip_n) = skip {
        // Skip/limit mode: đã filter hoặc đã sort. Projection áp nếu có.
        let sort_doc = match sort.as_deref() {
            Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
            _ => doc! { "_id": 1 },
        };
        let mut q = collection
            .find(user_filter)
            .sort(sort_doc)
            .skip(skip_n.max(0) as u64)
            .limit(limit);
        if let Some(p) = projection_doc {
            q = q.projection(p);
        }
        q.await?
    } else {
        // Keyset mode: pristine. Sort cố định {_id:1}; projection vẫn áp (không đổi thứ tự).
        let after = match after_id {
            Some(id) => Some(
                ObjectId::parse_str(&id)
                    .map_err(|e| AppError::Query(format!("invalid after_id: {e}")))?,
            ),
            None => None,
        };
        let query = build_query_filter(user_filter, after);
        let mut q = collection.find(query).sort(doc! { "_id": 1 }).limit(limit);
        if let Some(p) = projection_doc {
            q = q.projection(p);
        }
        q.await?
    };

    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(&d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn sample_documents(
    db: String,
    coll: String,
    filter: Option<String>,
    size: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = match filter.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => Document::new(),
    };

    let pipeline = build_sample_pipeline(user_filter, size);

    let mut cursor = collection.aggregate(pipeline).await?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(&d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn insert_document(
    db: String,
    coll: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client().await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.insert_one(new_doc).await?;
    bson_to_canonical_string(&res.inserted_id)
}

/// Reject a replacement whose embedded _id differs from the original (immutable _id).
fn ensure_id_unchanged(
    new_doc: &mongodb::bson::Document,
    id: &mongodb::bson::Bson,
) -> Result<(), AppError> {
    if let Some(new_id) = new_doc.get("_id") {
        if new_id != id {
            return Err(AppError::Query("không được đổi _id".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn replace_document(
    db: String,
    coll: String,
    id_json: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let id_bson = canonical_string_to_bson(&id_json)?;

    // _id is immutable: reject if the edited document carries a different _id.
    ensure_id_unchanged(&new_doc, &id_bson)?;

    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection
        .replace_one(doc! { "_id": id_bson }, new_doc)
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::Query("document không còn tồn tại".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    db: String,
    coll: String,
    id_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;

    let id_bson = canonical_string_to_bson(&id_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.delete_one(doc! { "_id": id_bson }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::Query("không tìm thấy document để xóa".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn filter_without_cursor_is_unchanged() {
        let user = doc! { "status": "active" };
        let out = build_query_filter(user.clone(), None);
        assert_eq!(out, user);
    }

    #[test]
    fn filter_with_cursor_wraps_in_and() {
        let oid = ObjectId::new();
        let out = build_query_filter(doc! { "status": "active" }, Some(oid));
        let and = out.get_array("$and").unwrap();
        assert_eq!(and.len(), 2);
        assert_eq!(and[0], Bson::Document(doc! { "status": "active" }));
        assert_eq!(and[1], Bson::Document(doc! { "_id": { "$gt": oid } }));
    }

    #[test]
    fn empty_user_filter_with_cursor_still_wraps() {
        let oid = ObjectId::new();
        let out = build_query_filter(Document::new(), Some(oid));
        let and = out.get_array("$and").unwrap();
        assert_eq!(and.len(), 2);
        assert_eq!(and[0], Bson::Document(Document::new()));
        assert_eq!(and[1], Bson::Document(doc! { "_id": { "$gt": oid } }));
    }

    #[test]
    fn sample_pipeline_without_filter_is_sample_only() {
        let out = build_sample_pipeline(Document::new(), 100);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], doc! { "$sample": { "size": 100_i64 } });
    }

    #[test]
    fn sample_pipeline_with_filter_matches_then_samples() {
        let user = doc! { "status": "active" };
        let out = build_sample_pipeline(user.clone(), 50);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], doc! { "$match": user });
        assert_eq!(out[1], doc! { "$sample": { "size": 50_i64 } });
    }
}
