use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_doc, canonical_string_to_doc_array};
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use tauri::State;

/// Parse a Canonical Extended JSON **array** of aggregation stages into Documents.
fn parse_pipeline(pipeline: &str) -> Result<Vec<Document>, AppError> {
    canonical_string_to_doc_array(
        pipeline,
        "pipeline must be an array of stages",
        "each pipeline stage must be an object",
    )
}

/// Parse an optional user-supplied ExtJSON filter (empty / None → empty Document).
pub(crate) fn parse_user_filter(filter: Option<&str>) -> Result<Document, AppError> {
    match filter {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s),
        _ => Ok(Document::new()),
    }
}

/// Build the shared "filter + sort + projection" query from optional string args.
/// Default sort is `{_id: 1}`; empty/None sort keeps that default.
/// Returns `(filter_doc, sort_doc, projection_doc)`.
pub(crate) fn build_find_options(
    filter: Option<&str>,
    sort: Option<&str>,
    projection: Option<&str>,
) -> Result<(Document, Document, Option<Document>), AppError> {
    let filter_doc = parse_user_filter(filter)?;
    let sort_doc = match sort {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => doc! { "_id": 1 },
    };
    let projection_doc = match projection {
        Some(s) if !s.trim().is_empty() => Some(canonical_string_to_doc(s)?),
        _ => None,
    };
    Ok((filter_doc, sort_doc, projection_doc))
}

/// Build a sampling pipeline for schema inspection, optionally pre-filtering.
/// Empty filter → `$sample` only; non-empty filter → `$match` then `$sample`.
fn build_sample_pipeline(user: Document, size: i64) -> Vec<Document> {
    if user.is_empty() {
        vec![doc! { "$sample": { "size": size } }]
    } else {
        vec![doc! { "$match": user }, doc! { "$sample": { "size": size } }]
    }
}

/// Appends optional `$skip`/`$limit` stages (in that order) to a pipeline. `skip <= 0` is a no-op
/// (page 1 needs no `$skip` stage at all).
fn build_aggregate_stages(mut stages: Vec<Document>, skip: Option<i64>, limit: Option<i64>) -> Vec<Document> {
    if let Some(n) = skip {
        if n > 0 {
            stages.push(doc! { "$skip": n });
        }
    }
    if let Some(n) = limit {
        stages.push(doc! { "$limit": n });
    }
    stages
}

/// Reads the `n` field out of a `$count` stage's single output document (`None` when the
/// pipeline matched nothing, since `$count` omits the stage's output document entirely then).
fn parse_count_doc(d: Option<Document>) -> u64 {
    d.and_then(|d| {
        d.get_i64("n").ok().map(|n| n as u64).or_else(|| d.get_i32("n").ok().map(|n| n as u64))
    })
    .unwrap_or(0)
}

#[tauri::command]
pub async fn aggregate(
    session_id: String,
    db: String,
    coll: String,
    pipeline: String,
    skip: Option<i64>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let stages = build_aggregate_stages(parse_pipeline(&pipeline)?, skip, limit);

    let mut cursor = collection.aggregate(stages).await?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn aggregate_count(
    session_id: String,
    db: String,
    coll: String,
    pipeline: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let mut stages = parse_pipeline(&pipeline)?;
    stages.push(doc! { "$count": "n" });

    let mut cursor = collection.aggregate(stages).await?;
    let doc = cursor.try_next().await?;
    Ok(parse_count_doc(doc))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_page(
    session_id: String,
    db: String,
    coll: String,
    skip: i64,                  // 0-based row offset (frontend converts 1-based page to skip)
    limit: i64,
    filter: Option<String>,
    sort: Option<String>,       // order-preserving ExtJSON doc, e.g. {"age":-1,"_id":1}; empty → {_id:1}
    projection: Option<String>, // ExtJSON exclusion doc, e.g. {"big":0}
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let (filter_doc, sort_doc, proj_doc) =
        build_find_options(filter.as_deref(), sort.as_deref(), projection.as_deref())?;

    let mut q = collection
        .find(filter_doc)
        .sort(sort_doc)
        .skip(skip.max(0) as u64)
        .limit(limit);
    if let Some(p) = proj_doc {
        q = q.projection(p);
    }
    let mut cursor = q.await?;

    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn sample_documents(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    size: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = parse_user_filter(filter.as_deref())?;

    let pipeline = build_sample_pipeline(user_filter, size);

    let mut cursor = collection.aggregate(pipeline).await?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn count_documents(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    Ok(collection.count_documents(f).await?)
}

#[tauri::command]
pub async fn distinct(
    session_id: String,
    db: String,
    coll: String,
    field: String,
    filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    let values = collection.distinct(&field, f).await?;
    values.iter().map(bson_to_canonical_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

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

    #[test]
    fn parse_pipeline_reads_array_of_stages() {
        let out = parse_pipeline(r#"[{"$match":{"a":1}},{"$limit":5}]"#).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].contains_key("$match"));
        assert!(out[1].contains_key("$limit"));
    }

    #[test]
    fn parse_pipeline_rejects_non_array() {
        assert!(matches!(parse_pipeline(r#"{"$match":{}}"#), Err(AppError::Query(_))));
    }

    #[test]
    fn parse_pipeline_rejects_non_object_stage() {
        assert!(matches!(parse_pipeline(r#"[1,2]"#), Err(AppError::Query(_))));
    }

    #[test]
    fn build_find_options_defaults_sort_to_id_asc() {
        let (filter, sort, proj) = build_find_options(None, None, None).unwrap();
        assert!(filter.is_empty());
        assert_eq!(sort, doc! { "_id": 1 });
        assert!(proj.is_none());
    }

    #[test]
    fn build_find_options_empty_sort_defaults_to_id_asc() {
        let (_, sort, _) = build_find_options(None, Some(""), None).unwrap();
        assert_eq!(sort, doc! { "_id": 1 });
    }

    #[test]
    fn build_find_options_parses_projection() {
        let (_, _, proj) =
            build_find_options(None, None, Some(r#"{"big":{"$numberInt":"0"}}"#)).unwrap();
        assert!(proj.is_some());
    }

    #[test]
    fn build_aggregate_stages_appends_skip_before_limit() {
        let stages = build_aggregate_stages(vec![doc! {"$match": {}}], Some(10), Some(5));
        assert_eq!(
            stages,
            vec![doc! {"$match": {}}, doc! {"$skip": 10_i64}, doc! {"$limit": 5_i64}]
        );
    }

    #[test]
    fn build_aggregate_stages_skips_a_zero_or_none_skip() {
        assert_eq!(build_aggregate_stages(vec![], Some(0), None), Vec::<Document>::new());
        assert_eq!(build_aggregate_stages(vec![], None, None), Vec::<Document>::new());
    }

    #[test]
    fn build_aggregate_stages_with_no_options_is_a_passthrough() {
        let stages = build_aggregate_stages(vec![doc! {"$match": {}}], None, None);
        assert_eq!(stages, vec![doc! {"$match": {}}]);
    }

    #[test]
    fn parse_count_doc_reads_i32_or_i64_n() {
        assert_eq!(parse_count_doc(Some(doc! {"n": 7_i32})), 7);
        assert_eq!(parse_count_doc(Some(doc! {"n": 7_i64})), 7);
    }

    #[test]
    fn parse_count_doc_missing_or_none_is_zero() {
        assert_eq!(parse_count_doc(None), 0);
        assert_eq!(parse_count_doc(Some(Document::new())), 0);
    }
}
