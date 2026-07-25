use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_doc, canonical_string_to_doc_array};
use crate::script::host::with_interrupt;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use mongodb::Client;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;

/// Default op deadline when the frontend doesn't pass one (matches `run_script`'s and `settings.queryTimeoutMs`'s defaults in the frontend).
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

fn deadline_from(timeout_ms: Option<u64>) -> Instant {
    Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS))
}

/// Shared prologue for every cancellable query command: fetch the client, get a freshly-reset cancel flag, and compute the op deadline.
async fn begin_query_op(
    state: &State<'_, AppState>,
    session_id: &str,
    timeout_ms: Option<u64>,
) -> Result<(Client, Arc<AtomicBool>, Instant), AppError> {
    let client = state.client(session_id).await?;
    let cancel = state.begin_cancel(session_id).await;
    Ok((client, cancel, deadline_from(timeout_ms)))
}

/// Time remaining until `deadline` (`None` once passed); fed into `maxTimeMS` so a "cancelled" query also stops consuming server CPU/IO, not just the client's wait.
fn remaining_until(deadline: Instant) -> Option<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() { None } else { Some(remaining) }
}

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

/// Build the shared "filter + sort + projection" query from optional string args; default sort is `{_id: 1}` when empty/None.
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

/// Build a sampling pipeline for schema inspection: empty filter → `$sample` only, non-empty → `$match` then `$sample`.
fn build_sample_pipeline(user: Document, size: i64) -> Vec<Document> {
    if user.is_empty() {
        vec![doc! { "$sample": { "size": size } }]
    } else {
        vec![doc! { "$match": user }, doc! { "$sample": { "size": size } }]
    }
}

/// Appends optional `$skip`/`$limit` stages (in that order) to a pipeline; `skip <= 0` is a no-op since page 1 needs no `$skip` stage at all.
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

/// Build `{explain: {find: coll, filter, sort, [projection], [skip], [limit]}, verbosity: "executionStats"}`.
fn build_explain_find_command(
    coll: &str,
    filter_doc: Document,
    sort_doc: Document,
    proj_doc: Option<Document>,
    skip: i64,
    limit: Option<i64>,
) -> Document {
    let mut find_cmd = doc! { "find": coll, "filter": filter_doc, "sort": sort_doc };
    if let Some(p) = proj_doc {
        find_cmd.insert("projection", p);
    }
    if skip > 0 {
        find_cmd.insert("skip", skip);
    }
    if let Some(l) = limit {
        find_cmd.insert("limit", l);
    }
    doc! { "explain": find_cmd, "verbosity": "executionStats" }
}

/// Build `{explain: {aggregate: coll, pipeline, cursor: {}}, verbosity: "executionStats"}`.
fn build_explain_aggregate_command(coll: &str, stages: Vec<Document>) -> Document {
    let agg_cmd = doc! { "aggregate": coll, "pipeline": stages, "cursor": {} };
    doc! { "explain": agg_cmd, "verbosity": "executionStats" }
}

/// Reads the `n` field out of a `$count` stage's single output document (`None` when the pipeline matched nothing, since `$count` then omits it entirely).
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
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let stages = build_aggregate_stages(parse_pipeline(&pipeline)?, skip, limit);

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut agg = collection.aggregate(stages);
        if let Some(mt) = remaining_until(deadline) {
            agg = agg.max_time(mt);
        }
        let mut cursor = agg.await?;
        let mut docs = Vec::new();
        while let Some(d) = cursor.try_next().await? {
            docs.push(doc_to_canonical_string(d)?);
        }
        Ok(docs)
    })
    .await
}

#[tauri::command]
pub async fn aggregate_count(
    session_id: String,
    db: String,
    coll: String,
    pipeline: String,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let mut stages = parse_pipeline(&pipeline)?;
    stages.push(doc! { "$count": "n" });

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut agg = collection.aggregate(stages);
        if let Some(mt) = remaining_until(deadline) {
            agg = agg.max_time(mt);
        }
        let mut cursor = agg.await?;
        let doc = cursor.try_next().await?;
        Ok(parse_count_doc(doc))
    })
    .await
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
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let (filter_doc, sort_doc, proj_doc) =
        build_find_options(filter.as_deref(), sort.as_deref(), projection.as_deref())?;

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut q = collection
            .find(filter_doc)
            .sort(sort_doc)
            .skip(skip.max(0) as u64)
            .limit(limit);
        if let Some(p) = proj_doc {
            q = q.projection(p);
        }
        if let Some(mt) = remaining_until(deadline) {
            q = q.max_time(mt);
        }
        let mut cursor = q.await?;

        let mut docs = Vec::new();
        while let Some(d) = cursor.try_next().await? {
            docs.push(doc_to_canonical_string(d)?);
        }
        Ok(docs)
    })
    .await
}

#[tauri::command]
pub async fn sample_documents(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    size: i64,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let user_filter = parse_user_filter(filter.as_deref())?;
    let pipeline = build_sample_pipeline(user_filter, size);

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut agg = collection.aggregate(pipeline);
        if let Some(mt) = remaining_until(deadline) {
            agg = agg.max_time(mt);
        }
        let mut cursor = agg.await?;
        let mut docs = Vec::new();
        while let Some(d) = cursor.try_next().await? {
            docs.push(doc_to_canonical_string(d)?);
        }
        Ok(docs)
    })
    .await
}

#[tauri::command]
pub async fn count_documents(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let f = parse_user_filter(filter.as_deref())?;

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut c = collection.count_documents(f);
        if let Some(mt) = remaining_until(deadline) {
            c = c.max_time(mt);
        }
        Ok(c.await?)
    })
    .await
}

#[tauri::command]
pub async fn distinct(
    session_id: String,
    db: String,
    coll: String,
    field: String,
    filter: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let f = parse_user_filter(filter.as_deref())?;

    with_interrupt(cancel, deadline, async move {
        let collection = client.database(&db).collection::<Document>(&coll);
        let mut d = collection.distinct(&field, f);
        if let Some(mt) = remaining_until(deadline) {
            d = d.max_time(mt);
        }
        let values = d.await?;
        values.iter().map(bson_to_canonical_string).collect()
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn explain_find(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    skip: i64,
    limit: Option<i64>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let (filter_doc, sort_doc, proj_doc) =
        build_find_options(filter.as_deref(), sort.as_deref(), projection.as_deref())?;
    let cmd = build_explain_find_command(&coll, filter_doc, sort_doc, proj_doc, skip, limit);

    with_interrupt(cancel, deadline, async move {
        let mut cmd = cmd;
        if let Some(mt) = remaining_until(deadline) {
            cmd.insert("maxTimeMS", mt.as_millis() as i64);
        }
        let reply = client.database(&db).run_command(cmd).await?;
        doc_to_canonical_string(reply)
    })
    .await
}

#[tauri::command]
pub async fn explain_aggregate(
    session_id: String,
    db: String,
    coll: String,
    pipeline: String,
    skip: Option<i64>,
    limit: Option<i64>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (client, cancel, deadline) = begin_query_op(&state, &session_id, timeout_ms).await?;

    let stages = build_aggregate_stages(parse_pipeline(&pipeline)?, skip, limit);
    let cmd = build_explain_aggregate_command(&coll, stages);

    with_interrupt(cancel, deadline, async move {
        let mut cmd = cmd;
        if let Some(mt) = remaining_until(deadline) {
            cmd.insert("maxTimeMS", mt.as_millis() as i64);
        }
        let reply = client.database(&db).run_command(cmd).await?;
        doc_to_canonical_string(reply)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn deadline_from_none_uses_the_default_timeout() {
        let before = Instant::now();
        let d = deadline_from(None);
        assert!(d >= before + Duration::from_millis(DEFAULT_TIMEOUT_MS) - Duration::from_millis(5));
        assert!(d <= before + Duration::from_millis(DEFAULT_TIMEOUT_MS) + Duration::from_millis(1000));
    }

    #[test]
    fn deadline_from_some_uses_the_given_timeout() {
        let before = Instant::now();
        let d = deadline_from(Some(500));
        assert!(d >= before + Duration::from_millis(495));
        assert!(d <= before + Duration::from_millis(1500));
    }

    #[test]
    fn remaining_until_future_deadline_is_some_and_roughly_matches() {
        let deadline = Instant::now() + Duration::from_millis(1000);
        let r = remaining_until(deadline).expect("deadline is in the future");
        assert!(r <= Duration::from_millis(1000));
        assert!(r >= Duration::from_millis(900));
    }

    #[test]
    fn remaining_until_past_deadline_is_none() {
        let deadline = Instant::now() - Duration::from_millis(10);
        assert_eq!(remaining_until(deadline), None);
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

    #[test]
    fn build_explain_find_command_wraps_find_with_verbosity() {
        let (filter, sort, proj) = build_find_options(Some(r#"{"a":{"$numberInt":"1"}}"#), None, None).unwrap();
        let cmd = build_explain_find_command("orders", filter.clone(), sort.clone(), proj, 0, None);
        assert_eq!(
            cmd,
            doc! {
                "explain": {
                    "find": "orders",
                    "filter": filter,
                    "sort": sort,
                },
                "verbosity": "executionStats",
            }
        );
    }

    #[test]
    fn build_explain_find_command_includes_skip_and_limit_when_set() {
        let (filter, sort, proj) = build_find_options(None, None, None).unwrap();
        let cmd = build_explain_find_command("orders", filter, sort, proj, 10, Some(5));
        let find_cmd = cmd.get_document("explain").unwrap();
        assert_eq!(find_cmd.get_i64("skip").unwrap(), 10);
        assert_eq!(find_cmd.get_i64("limit").unwrap(), 5);
    }

    #[test]
    fn build_explain_find_command_omits_zero_skip_and_missing_limit() {
        let (filter, sort, proj) = build_find_options(None, None, None).unwrap();
        let cmd = build_explain_find_command("orders", filter, sort, proj, 0, None);
        let find_cmd = cmd.get_document("explain").unwrap();
        assert!(!find_cmd.contains_key("skip"));
        assert!(!find_cmd.contains_key("limit"));
    }

    #[test]
    fn build_explain_find_command_includes_projection_when_set() {
        let (filter, sort, proj) =
            build_find_options(None, None, Some(r#"{"big":{"$numberInt":"0"}}"#)).unwrap();
        let cmd = build_explain_find_command("orders", filter, sort, proj, 0, None);
        let find_cmd = cmd.get_document("explain").unwrap();
        assert!(find_cmd.contains_key("projection"));
    }

    #[test]
    fn build_explain_aggregate_command_wraps_aggregate_with_cursor_and_verbosity() {
        let stages = build_aggregate_stages(vec![doc! {"$match": {"a": 1}}], None, None);
        let cmd = build_explain_aggregate_command("orders", stages.clone());
        assert_eq!(
            cmd,
            doc! {
                "explain": {
                    "aggregate": "orders",
                    "pipeline": stages,
                    "cursor": {},
                },
                "verbosity": "executionStats",
            }
        );
    }
}
