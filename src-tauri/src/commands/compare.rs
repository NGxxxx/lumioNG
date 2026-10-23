//! Compare two collections (possibly on different sessions / clusters) and sync one into the other.
//!
//! Safety rules enforced here, never trusted from the frontend:
//! - the written side's environment and read-only flag come from `AppState::meta`;
//! - a read-only written side is refused, a PROD one needs `confirmed` (set by the UI's destructive gate);
//! - a real sync needs a dry run of the exact same plan (hash over both namespaces, key, filter,
//!   ignored fields, flags and direction) in this app session within the last 10 minutes; each dry
//!   run authorizes one sync.

use crate::audit::{AuditEntry, AuditError, SOURCE_SYNC};
use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::compare::{
    cmp_key, key_of, merge_diff, run_sync, BatchOutcome, DiffKind, DiffOptions, DiffSummary, MergeJoin, SyncCounts, SyncFlags,
    SyncReport, SyncSink, MAX_DIFF_KEYS,
};
use crate::error::AppError;
use crate::state::{AppState, SessionMeta};
use futures::stream::{BoxStream, StreamExt};
use mongodb::bson::{doc, Bson, Document};
use mongodb::error::{ErrorKind, WriteFailure};
use mongodb::options::Collation;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, State};

/// How long a dry run authorizes the matching real sync.
pub const DRY_RUN_TTL: Duration = Duration::from_secs(10 * 60);
/// Progress is reported every this many documents read.
const PROGRESS_EVERY: u64 = 1000;
const MAX_PAGE: u64 = 500;

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NsRef {
    pub session_id: String,
    pub db: String,
    pub coll: String,
}

impl NsRef {
    fn ns(&self) -> String {
        format!("{}.{}", self.db, self.coll)
    }
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    /// Write into `dst` so it matches `src`.
    SrcToDst,
    /// Write into `src` so it matches `dst`.
    DstToSrc,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub src: NsRef,
    pub dst: NsRef,
    pub key: String,
    pub filter: Option<String>,
    pub ignore_fields: Vec<String>,
    pub insert_missing: bool,
    pub replace_different: bool,
    pub delete_extra: bool,
    pub direction: Direction,
}

impl SyncPlan {
    fn flags(&self) -> SyncFlags {
        SyncFlags { insert_missing: self.insert_missing, replace_different: self.replace_different, delete_extra: self.delete_extra }
    }

    /// `(read from, written to)`.
    pub fn ends(&self) -> (&NsRef, &NsRef) {
        match self.direction {
            Direction::SrcToDst => (&self.src, &self.dst),
            Direction::DstToSrc => (&self.dst, &self.src),
        }
    }

    /// Identity of the plan: everything that changes what a sync would write.
    pub fn hash(&self) -> String {
        let mut ignore = clean_fields(&self.ignore_fields);
        ignore.sort();
        ignore.dedup();
        let canonical = serde_json::json!({
            "src": self.src,
            "dst": self.dst,
            "key": key_or_id(&self.key),
            "filter": self.filter.as_deref().unwrap_or("").trim(),
            "ignore": ignore,
            "insert": self.insert_missing,
            "replace": self.replace_different,
            "delete": self.delete_extra,
            "direction": self.direction,
        });
        format!("{:x}", Sha256::digest(canonical.to_string().as_bytes()))
    }

    fn pair(&self) -> String {
        serde_json::json!([self.src, self.dst]).to_string()
    }
}

fn clean_fields(fields: &[String]) -> Vec<String> {
    fields.iter().map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect()
}

fn key_or_id(key: &str) -> String {
    match key.trim() {
        "" => "_id".to_string(),
        k => k.to_string(),
    }
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompareProgress {
    /// Documents read from both sides so far.
    pub read: u64,
    /// Both collections' estimated sizes when no filter is set; `None` otherwise.
    pub total: Option<u64>,
    /// Documents written so far (sync only).
    pub written: u64,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub kind: DiffKind,
    /// The key value as Canonical Extended JSON.
    pub key: String,
    /// The current source / destination document (Canonical Extended JSON), `None` when absent now.
    pub src: Option<String>,
    pub dst: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffPage {
    pub rows: Vec<DiffRow>,
    /// Keys stored for this kind (the cap can make it smaller than the summary's count).
    pub total: u64,
}

struct StoredCompare {
    src: NsRef,
    dst: NsRef,
    key: String,
    keys: HashMap<DiffKind, Vec<Bson>>,
}

struct DryRunMark {
    hash: String,
    at: Instant,
    sessions: [String; 2],
    /// What the dry run announced: per-operation ceilings for the sync it authorizes.
    planned: SyncCounts,
}

/// Compare results (keys only, capped) per compare tab, the last dry run per (src, dst) pair, and a
/// cancel flag per compare tab (kept apart from the sessions' Job flags, so compare/sync never
/// cancels or resets an export or import).
#[derive(Default)]
pub struct CompareState {
    results: std::sync::Mutex<HashMap<String, StoredCompare>>,
    dry_runs: std::sync::Mutex<HashMap<String, DryRunMark>>,
    cancels: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
}

use crate::util::lock_recover as lock;

impl CompareState {
    pub fn record_dry_run(&self, plan: &SyncPlan, planned: SyncCounts, now: Instant) {
        let mark = DryRunMark { hash: plan.hash(), at: now, sessions: [plan.src.session_id.clone(), plan.dst.session_id.clone()], planned };
        lock(&self.dry_runs).insert(plan.pair(), mark);
    }

    /// Consumes the dry run that authorizes `plan` and returns its planned counts (the sync's
    /// ceilings), or explains why there is none.
    pub fn take_dry_run(&self, plan: &SyncPlan, now: Instant) -> Result<SyncCounts, AppError> {
        let mut g = lock(&self.dry_runs);
        let ok = match g.get(&plan.pair()) {
            None => Err("Run a dry run of this sync first."),
            Some(m) if m.hash != plan.hash() => Err("The sync settings changed since the dry run. Run the dry run again."),
            Some(m) if now.saturating_duration_since(m.at) > DRY_RUN_TTL => Err("The dry run is more than 10 minutes old. Run it again."),
            Some(_) => Ok(()),
        };
        match ok {
            Ok(()) => Ok(g.remove(&plan.pair()).map(|m| m.planned).unwrap_or_default()),
            Err(msg) => Err(AppError::Query(msg.into())),
        }
    }

    /// A fresh (not cancelled) flag for a compare tab's next compare or sync.
    pub fn begin_cancel(&self, compare_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        lock(&self.cancels).insert(compare_id.to_string(), flag.clone());
        flag
    }

    pub fn request_cancel(&self, compare_id: &str) {
        if let Some(f) = lock(&self.cancels).get(compare_id) {
            f.store(true, Ordering::Relaxed);
        }
    }

    fn dispose(&self, compare_id: &str) {
        lock(&self.results).remove(compare_id);
        lock(&self.cancels).remove(compare_id);
    }

    /// Drops results and dry runs that involve a closed session.
    pub fn forget_session(&self, session_id: &str) {
        lock(&self.results).retain(|_, c| c.src.session_id != session_id && c.dst.session_id != session_id);
        lock(&self.dry_runs).retain(|_, m| !m.sessions.iter().any(|s| s == session_id));
    }
}

/// The written side must be writable; on PROD a real sync also needs the UI's explicit confirmation.
pub fn check_target(meta: &SessionMeta, dry_run: bool, confirmed: bool) -> Result<(), AppError> {
    if meta.read_only {
        return Err(AppError::Query(format!("The sync destination \"{}\" is a read-only connection.", meta.label)));
    }
    if crate::registry::is_prod(&meta.environment) && !dry_run && !confirmed {
        return Err(AppError::Query(format!("The sync destination \"{}\" is PROD; confirm the sync first.", meta.label)));
    }
    Ok(())
}

fn validate(src: &NsRef, dst: &NsRef, key: &str) -> Result<(), AppError> {
    if src == dst {
        return Err(AppError::Query("Source and destination are the same collection.".into()));
    }
    if [&src.db, &src.coll, &dst.db, &dst.coll].iter().any(|s| s.trim().is_empty()) {
        return Err(AppError::Query("Pick a database and collection on both sides.".into()));
    }
    if key.starts_with('$') || key.split('.').any(|p| p.is_empty()) {
        return Err(AppError::Query(format!("`{key}` is not a valid key field.")));
    }
    Ok(())
}

fn parse_filter(filter: Option<&str>) -> Result<Document, AppError> {
    crate::commands::query::parse_user_filter(filter)
}

/// Ascending on the key (a dotted path is one field name here, as the server expects).
fn sort_spec(key: &str) -> Document {
    let mut d = Document::new();
    d.insert(key, 1);
    d
}

/// `{ <key>: { $in: keys } }`.
fn in_filter(key: &str, keys: &[Bson]) -> Document {
    let mut d = Document::new();
    d.insert(key, doc! { "$in": keys.to_vec() });
    d
}

/// Binary string order on both sides, whatever the collections' default collations are, so the
/// server's order matches `cmp_key`.
fn simple() -> Collation {
    Collation::builder().locale("simple").build()
}

/// `find` accepts `allowDiskUse` from wire version 9 (MongoDB 4.4); older servers reject the field.
pub fn find_disk_use_supported(hello: &Document) -> bool {
    let wire = match hello.get("maxWireVersion") {
        Some(Bson::Int32(n)) => *n as i64,
        Some(Bson::Int64(n)) => *n,
        _ => 0,
    };
    wire >= 9
}

/// Asks the server once per side and run (`hello`, or `isMaster` on servers before 4.4.2).
async fn disk_use_supported(client: &mongodb::Client) -> bool {
    let admin = client.database("admin");
    let reply = match admin.run_command(doc! { "hello": 1 }).await {
        Ok(r) => Ok(r),
        Err(_) => admin.run_command(doc! { "isMaster": 1 }).await,
    };
    reply.map(|r| find_disk_use_supported(&r)).unwrap_or(false)
}

/// Turns the server's "sort used too much memory" failure into advice: without `allowDiskUse`
/// (MongoDB 4.2) an unindexed key is sorted in memory and capped, so the key needs an index.
pub fn sort_memory_hint(e: AppError, key: &str, ns: &NsRef) -> AppError {
    let text = e.to_string();
    let lower = text.to_lowercase();
    let memory = matches!(&e, AppError::Server { code: 292 | 16819, .. })
        || (lower.contains("sort") && (lower.contains("ram") || lower.contains("memory limit")));
    if !memory {
        return e;
    }
    AppError::Query(format!(
        "Sorting {}.{} by `{key}` needs more memory than the server allows for an in-memory sort. \
         Create an index on `{key}` (simple collation) and compare again. ({text})",
        ns.db, ns.coll
    ))
}

/// The client compare/sync reads and writes with: the NON-decrypting one, so encrypted fields are
/// compared and copied as ciphertext, byte for byte (a decrypted copy would store plaintext).
pub(crate) async fn data_client(state: &AppState, session_id: &str) -> Result<mongodb::Client, AppError> {
    state.raw_client(session_id).await
}

async fn open_sorted(state: &AppState, ns: &NsRef, key: &str, filter: &Document) -> Result<BoxStream<'static, Result<Document, AppError>>, AppError> {
    let client = data_client(state, &ns.session_id).await?;
    let coll = client.database(&ns.db).collection::<Document>(&ns.coll);
    let mut find = coll.find(filter.clone()).sort(sort_spec(key)).collation(simple());
    // 4.4+: a key without a (simple-collation) index may spill to disk instead of hitting the
    // in-memory sort cap. 4.2 rejects the option, so there the key needs an index (see the hint).
    if disk_use_supported(&client).await {
        find = find.allow_disk_use(true);
    }
    let cursor = find.await.map_err(|e| sort_memory_hint(e.into(), key, ns))?;
    let (key, ns) = (key.to_string(), ns.clone());
    Ok(cursor.map(move |r| r.map_err(|e| sort_memory_hint(e.into(), &key, &ns))).boxed())
}

async fn estimate_total(state: &AppState, a: &NsRef, b: &NsRef, filter: &Document) -> Option<u64> {
    if !filter.is_empty() {
        return None;
    }
    let count = |ns: &NsRef| {
        let ns = ns.clone();
        async move {
            let client = data_client(state, &ns.session_id).await.ok()?;
            client.database(&ns.db).collection::<Document>(&ns.coll).estimated_document_count().await.ok()
        }
    };
    let (x, y) = tokio::join!(count(a), count(b));
    Some(x? + y?)
}

pub async fn compare_run(
    state: &AppState,
    compare_id: &str,
    src: NsRef,
    dst: NsRef,
    key: &str,
    filter: Option<&str>,
    ignore_fields: &[String],
    progress: impl Fn(CompareProgress),
) -> Result<DiffSummary, AppError> {
    let key = key_or_id(key);
    validate(&src, &dst, &key)?;
    let filter = parse_filter(filter)?;
    lock(&state.compare.results).remove(compare_id);
    let cancel = state.compare.begin_cancel(compare_id);
    let total = estimate_total(state, &src, &dst, &filter).await;
    let (a, b) = tokio::try_join!(open_sorted(state, &src, &key, &filter), open_sorted(state, &dst, &key, &filter))?;
    let opts = DiffOptions { key: key.clone(), ignore_fields: clean_fields(ignore_fields), cap: MAX_DIFF_KEYS };
    let mut keys: HashMap<DiffKind, Vec<Bson>> = HashMap::new();
    let mut last = 0;
    let summary = merge_diff(
        a,
        b,
        &opts,
        |item| keys.entry(item.kind).or_default().push(item.key),
        |read| {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::Query("Compare cancelled".into()));
            }
            if read / PROGRESS_EVERY != last {
                last = read / PROGRESS_EVERY;
                progress(CompareProgress { read, total, written: 0 });
            }
            Ok(())
        },
    )
    .await?;
    progress(CompareProgress { read: summary.only_src + summary.only_dst + 2 * (summary.different + summary.same), total, written: 0 });
    lock(&state.compare.results).insert(compare_id.to_string(), StoredCompare { src, dst, key, keys });
    Ok(summary)
}

/// Current documents for `keys` in `ns`, matched back to their key with the comparison's own order.
async fn fetch_by_keys(state: &AppState, ns: &NsRef, key: &str, keys: &[Bson]) -> Result<Vec<(Bson, Document)>, AppError> {
    let client = data_client(state, &ns.session_id).await?;
    let coll = client.database(&ns.db).collection::<Document>(&ns.coll);
    let mut cursor = coll.find(in_filter(key, keys)).collation(simple()).await?;
    let mut out = Vec::new();
    while let Some(d) = cursor.next().await {
        let d = d?;
        if let Ok(k) = key_of(&d, key) {
            out.push((k, d));
        }
    }
    Ok(out)
}

fn take_match(found: &mut Vec<(Bson, Document)>, key: &Bson) -> Result<Option<String>, AppError> {
    match found.iter().position(|(k, _)| cmp_key(k, key) == Some(std::cmp::Ordering::Equal)) {
        Some(i) => Ok(Some(doc_to_canonical_string(found.swap_remove(i).1)?)),
        None => Ok(None),
    }
}

pub async fn compare_page_run(state: &AppState, compare_id: &str, kind: DiffKind, skip: u64, limit: u64) -> Result<DiffPage, AppError> {
    let (src, dst, key, total, keys) = {
        let g = lock(&state.compare.results);
        let c = g.get(compare_id).ok_or_else(|| AppError::Query("Run the comparison first.".into()))?;
        let all = c.keys.get(&kind).map(Vec::as_slice).unwrap_or(&[]);
        let from = (skip as usize).min(all.len());
        let to = (from + limit.min(MAX_PAGE) as usize).min(all.len());
        (c.src.clone(), c.dst.clone(), c.key.clone(), all.len() as u64, all[from..to].to_vec())
    };
    let fetch = |ns: &NsRef, wanted: bool| {
        let ns = ns.clone();
        let (key, keys) = (&key, &keys);
        async move { if wanted && !keys.is_empty() { fetch_by_keys(state, &ns, key, keys).await } else { Ok(vec![]) } }
    };
    let (mut src_docs, mut dst_docs) =
        tokio::try_join!(fetch(&src, kind != DiffKind::OnlyDst), fetch(&dst, kind != DiffKind::OnlySrc))?;
    let mut rows = Vec::with_capacity(keys.len());
    for k in &keys {
        rows.push(DiffRow {
            kind,
            key: bson_to_canonical_string(k)?,
            src: take_match(&mut src_docs, k)?,
            dst: take_match(&mut dst_docs, k)?,
        });
    }
    Ok(DiffPage { rows, total })
}

// ── writes ──

/// Writes into the target collection; every batch leaves one audit line (`source: "sync"`) with the
/// namespace, the count and, on failure, a value-free error summary.
struct MongoSink<'a> {
    state: &'a AppState,
    coll: mongodb::Collection<Document>,
    ns: String,
    label: String,
    environment: String,
}

fn write_error_summary(code: i32, code_name: Option<&str>, failed: u64) -> String {
    match code_name.filter(|n| !n.is_empty()) {
        Some(n) => format!("{code} {n} ({failed} failed)"),
        None => format!("{code} ({failed} failed)"),
    }
}

impl MongoSink<'_> {
    fn audit(&self, op: &str, count: Option<u64>, error: Option<String>) {
        let mut e = AuditEntry::new(SOURCE_SYNC, op, &self.ns).with_session(&self.label, &self.environment).with_count(count);
        if let Some(s) = error {
            e = e.with_error(&s);
        }
        if let Err(err) = self.state.audit.record(e) {
            tracing::error!("audit log write failed: {err}");
        }
    }

    fn fatal(&self, op: &str, e: mongodb::error::Error) -> AppError {
        let e = AppError::from(e);
        self.audit(op, None, Some(e.audit_summary()));
        e
    }
}

impl SyncSink for MongoSink<'_> {
    async fn insert(&mut self, docs: Vec<Document>) -> Result<BatchOutcome, AppError> {
        let n = docs.len() as u64;
        match self.coll.insert_many(docs).ordered(false).await {
            Ok(r) => {
                let applied = r.inserted_ids.len() as u64;
                self.audit("sync_insert", Some(applied), None);
                Ok(BatchOutcome { applied, ..Default::default() })
            }
            Err(e) => match &*e.kind {
                // Write concern not satisfied: the inserts may exist but are not confirmed, so they count as failed.
                ErrorKind::InsertMany(ime) if ime.write_concern_error.is_some() => {
                    let code = ime.write_concern_error.as_ref().map(|w| w.code).unwrap_or(0);
                    self.audit("sync_insert", Some(0), Some(format!("writeConcernError {code} ({n} failed)")));
                    let msg = ime.write_concern_error.as_ref().map(|w| w.message.clone()).unwrap_or_default();
                    Ok(BatchOutcome { applied: 0, failed: n, errors: vec![format!("write concern error: {msg}")] })
                }
                ErrorKind::InsertMany(ime) if ime.write_errors.as_ref().is_some_and(|w| !w.is_empty()) => {
                    let we = ime.write_errors.as_deref().unwrap_or(&[]);
                    let failed = we.len() as u64;
                    let applied = n.saturating_sub(failed);
                    self.audit("sync_insert", Some(applied), Some(write_error_summary(we[0].code, we[0].code_name.as_deref(), failed)));
                    Ok(BatchOutcome { applied, failed, errors: we.iter().take(5).map(|w| w.message.clone()).collect() })
                }
                _ => Err(self.fatal("sync_insert", e)),
            },
        }
    }

    async fn replace(&mut self, docs: Vec<(Bson, Document)>) -> Result<BatchOutcome, AppError> {
        // A raw `update` command batches replacements on every server version (bulkWrite needs 8.0).
        let updates: Vec<Document> = docs.into_iter().map(|(id, d)| doc! { "q": { "_id": id }, "u": d, "upsert": false, "multi": false }).collect();
        let cmd = doc! { "update": self.coll.name(), "updates": updates, "ordered": false };
        let reply = match self.coll.client().database(self.coll.namespace().db.as_str()).run_command(cmd).await {
            Ok(r) => r,
            Err(e) => return Err(self.fatal("sync_replace", e)),
        };
        let (out, summary) = update_reply_outcome(&reply);
        self.audit("sync_replace", Some(out.applied), summary);
        Ok(out)
    }

    async fn delete(&mut self, ids: Vec<Bson>) -> Result<BatchOutcome, AppError> {
        let n = ids.len() as u64;
        match self.coll.delete_many(doc! { "_id": { "$in": ids } }).await {
            Ok(r) => {
                self.audit("sync_delete", Some(r.deleted_count), None);
                Ok(BatchOutcome { applied: r.deleted_count, ..Default::default() })
            }
            Err(e) => match &*e.kind {
                ErrorKind::Write(WriteFailure::WriteConcernError(w)) => {
                    self.audit("sync_delete", Some(0), Some(format!("writeConcernError {} ({n} failed)", w.code)));
                    Ok(BatchOutcome { applied: 0, failed: n, errors: vec![format!("write concern error: {}", w.message)] })
                }
                _ => Err(self.fatal("sync_delete", e)),
            },
        }
    }
}

/// Reads a raw `update` command reply: `n` matched (= replaced), `writeErrors` failed, and a
/// `writeConcernError` turns the batch's matched statements into failures too (not confirmed).
/// Returns the outcome and a value-free audit summary when anything failed.
pub fn update_reply_outcome(reply: &Document) -> (BatchOutcome, Option<String>) {
    let matched = match reply.get("n") {
        Some(Bson::Int32(n)) => *n as u64,
        Some(Bson::Int64(n)) => *n as u64,
        _ => 0,
    };
    let errs: Vec<&Document> = reply.get_array("writeErrors").map(|a| a.iter().filter_map(Bson::as_document).collect()).unwrap_or_default();
    let mut failed = errs.len() as u64;
    let mut summary = errs.first().map(|w| write_error_summary(w.get_i32("code").unwrap_or(0), w.get_str("codeName").ok(), failed));
    let mut errors: Vec<String> = errs.iter().take(5).map(|w| w.get_str("errmsg").unwrap_or("write error").to_string()).collect();
    let mut applied = matched;
    if let Ok(wce) = reply.get_document("writeConcernError") {
        let code = wce.get_i32("code").unwrap_or(0);
        failed += matched;
        applied = 0;
        summary = Some(format!("writeConcernError {code} ({failed} failed)"));
        errors.push(format!("write concern error: {}", wce.get_str("errmsg").unwrap_or("not satisfied")));
    }
    (BatchOutcome { applied, failed, errors }, summary)
}

pub async fn sync_run(
    state: &AppState,
    compare_id: &str,
    plan: SyncPlan,
    dry_run: bool,
    confirmed: bool,
    progress: impl Fn(CompareProgress),
) -> Result<SyncReport, AppError> {
    let key = key_or_id(&plan.key);
    validate(&plan.src, &plan.dst, &key)?;
    if !(plan.insert_missing || plan.replace_different || plan.delete_extra) {
        return Err(AppError::Query("Pick at least one sync operation.".into()));
    }
    let filter = parse_filter(plan.filter.as_deref())?;
    let (from, to) = plan.ends();
    // Environment and read-only come from Rust's own session record, never from the caller.
    let meta = state.meta(&to.session_id).await?;
    check_target(&meta, dry_run, confirmed)?;
    data_client(state, &from.session_id).await?;
    let limits = if dry_run { None } else { Some(state.compare.take_dry_run(&plan, Instant::now())?) };
    let cancel = state.compare.begin_cancel(compare_id);
    let total = estimate_total(state, from, to, &filter).await;
    let (a, b) = tokio::try_join!(open_sorted(state, from, &key, &filter), open_sorted(state, to, &key, &filter))?;
    let join = MergeJoin::new(a, b, &key, &clean_fields(&plan.ignore_fields));
    let client = data_client(state, &to.session_id).await?;
    let mut sink = MongoSink {
        state,
        coll: client.database(&to.db).collection::<Document>(&to.coll),
        ns: to.ns(),
        label: meta.label.clone(),
        environment: meta.environment.clone(),
    };
    let mut last = 0;
    let report = run_sync(join, plan.flags(), key == "_id", dry_run, limits, &mut sink, |read, written| {
        if read / PROGRESS_EVERY != last {
            last = read / PROGRESS_EVERY;
            progress(CompareProgress { read, total, written });
        }
        !cancel.load(Ordering::Relaxed)
    })
    .await?;
    if dry_run && !report.cancelled {
        state.compare.record_dry_run(&plan, report.planned.clone(), Instant::now());
    }
    Ok(report)
}

// ── commands ──

#[tauri::command]
pub async fn compare_start(
    compare_id: String,
    src: NsRef,
    dst: NsRef,
    key: Option<String>,
    filter: Option<String>,
    ignore_fields: Vec<String>,
    on_progress: Channel<CompareProgress>,
    state: State<'_, AppState>,
) -> Result<DiffSummary, AppError> {
    compare_run(&state, &compare_id, src, dst, key.as_deref().unwrap_or("_id"), filter.as_deref(), &ignore_fields, |p| {
        let _ = on_progress.send(p);
    })
    .await
}

#[tauri::command]
pub async fn compare_page(compare_id: String, kind: DiffKind, skip: u64, limit: u64, state: State<'_, AppState>) -> Result<DiffPage, AppError> {
    if kind == DiffKind::Same {
        return Err(AppError::Query("Identical documents are not listed.".into()));
    }
    compare_page_run(&state, &compare_id, kind, skip, limit).await
}

/// Frees a closed compare tab's stored keys.
#[tauri::command]
pub async fn compare_dispose(compare_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.compare.dispose(&compare_id);
    Ok(())
}

/// Stops the compare tab's running compare or sync (its own flag; exports/imports are untouched).
#[tauri::command]
pub async fn compare_cancel(compare_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.compare.request_cancel(&compare_id);
    Ok(())
}

#[tauri::command]
pub async fn sync_apply(
    compare_id: String,
    plan: SyncPlan,
    dry_run: bool,
    confirmed: bool,
    on_progress: Channel<CompareProgress>,
    state: State<'_, AppState>,
) -> Result<SyncReport, AppError> {
    sync_run(&state, &compare_id, plan, dry_run, confirmed, |p| {
        let _ = on_progress.send(p);
    })
    .await
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn sync_reads_and_writes_through_the_non_decrypting_client() {
        let lazy = |db: &str| mongodb::Client::with_uri_str(format!("mongodb://127.0.0.1:1/{db}"));
        let state = AppState::default();
        for id in ["src", "dst"] {
            state.insert_session(id.into(), crate::state::Session::new(lazy(&format!("{id}_decrypting")).await.unwrap(), false, String::new(), String::new())).await;
            state.sessions.lock().await.get_mut(id).unwrap().raw_client = Some(lazy(&format!("{id}_raw")).await.unwrap());
        }
        // Both ends hand out the raw client, so ciphertext is compared and copied verbatim.
        for id in ["src", "dst"] {
            assert_eq!(data_client(&state, id).await.unwrap().default_database().unwrap().name(), format!("{id}_raw"));
        }
    }

    use super::*;
    use crate::state::CancelScope;
    use mongodb::Client;

    fn ns(session: &str, coll: &str) -> NsRef {
        NsRef { session_id: session.into(), db: "shop".into(), coll: coll.into() }
    }

    fn plan() -> SyncPlan {
        SyncPlan {
            src: ns("s1", "orders"),
            dst: ns("s2", "orders"),
            key: "_id".into(),
            filter: None,
            ignore_fields: vec!["updatedAt".into(), "meta.seen".into()],
            insert_missing: true,
            replace_different: true,
            delete_extra: false,
            direction: Direction::SrcToDst,
        }
    }

    fn meta(env: &str, read_only: bool) -> SessionMeta {
        SessionMeta { label: "Orders".into(), environment: env.into(), read_only }
    }

    #[test]
    fn plan_hash_covers_direction_flags_and_fields() {
        let base = plan().hash();
        assert_eq!(SyncPlan { ignore_fields: vec![" meta.seen".into(), "updatedAt".into(), "".into()], ..plan() }.hash(), base);
        assert_eq!(SyncPlan { key: "".into(), ..plan() }.hash(), base);
        for changed in [
            SyncPlan { direction: Direction::DstToSrc, ..plan() },
            SyncPlan { delete_extra: true, ..plan() },
            SyncPlan { insert_missing: false, ..plan() },
            SyncPlan { replace_different: false, ..plan() },
            SyncPlan { filter: Some("{\"a\":1}".into()), ..plan() },
            SyncPlan { key: "sku".into(), ..plan() },
            SyncPlan { ignore_fields: vec![], ..plan() },
            SyncPlan { dst: ns("s3", "orders"), ..plan() },
            SyncPlan { src: ns("s1", "orders2"), ..plan() },
        ] {
            assert_ne!(changed.hash(), base, "{changed:?}");
        }
    }

    #[test]
    fn real_sync_requires_a_recent_matching_dry_run() {
        let st = CompareState::default();
        let t0 = Instant::now();
        assert!(st.take_dry_run(&plan(), t0).unwrap_err().to_string().contains("dry run"));
        st.record_dry_run(&plan(), SyncCounts::default(), t0);
        let reversed = SyncPlan { direction: Direction::DstToSrc, ..plan() };
        assert!(st.take_dry_run(&reversed, t0).unwrap_err().to_string().contains("changed"));
        assert!(st.take_dry_run(&SyncPlan { delete_extra: true, ..plan() }, t0).is_err());
        st.take_dry_run(&plan(), t0 + Duration::from_secs(60)).unwrap();
        // The planned counts travel with the mark and come back as the sync's ceilings.
        st.record_dry_run(&plan(), SyncCounts { insert: 3, replace: 2, delete: 1 }, t0);
        assert_eq!(st.take_dry_run(&plan(), t0).unwrap(), SyncCounts { insert: 3, replace: 2, delete: 1 });
        st.record_dry_run(&plan(), SyncCounts::default(), t0);
        st.take_dry_run(&plan(), t0).unwrap();
        // One dry run authorizes one sync.
        assert!(st.take_dry_run(&plan(), t0 + Duration::from_secs(61)).is_err());
        st.record_dry_run(&plan(), SyncCounts::default(), t0);
        assert!(st.take_dry_run(&plan(), t0 + DRY_RUN_TTL + Duration::from_secs(1)).unwrap_err().to_string().contains("10 minutes"));
        st.record_dry_run(&plan(), SyncCounts::default(), t0);
        st.forget_session("s2");
        assert!(st.take_dry_run(&plan(), t0).is_err());
    }

    #[test]
    fn prod_destination_requires_confirmation_and_read_only_is_refused() {
        assert!(check_target(&meta("prod", false), false, false).unwrap_err().to_string().contains("PROD"));
        check_target(&meta("prod", false), false, true).unwrap();
        check_target(&meta("prod", false), true, false).unwrap();
        check_target(&meta("dev", false), false, false).unwrap();
        assert!(check_target(&meta("dev", true), true, true).unwrap_err().to_string().contains("read-only"));
    }

    #[test]
    fn direction_picks_the_written_side() {
        let p = plan();
        assert_eq!(p.ends(), (&p.src, &p.dst));
        let r = SyncPlan { direction: Direction::DstToSrc, ..plan() };
        assert_eq!(r.ends(), (&r.dst, &r.src));
    }

    #[test]
    fn write_concern_errors_count_as_failed() {
        let (out, summary) = update_reply_outcome(&doc! { "n": 3, "nModified": 3, "ok": 1 });
        assert_eq!((out.applied, out.failed, summary), (3, 0, None));
        let reply = doc! {
            "n": 2, "ok": 1,
            "writeErrors": [{ "index": 1, "code": 11000, "codeName": "DuplicateKey", "errmsg": "E11000 dup key: { email: \"x\" }" }],
            "writeConcernError": { "code": 64, "errmsg": "waiting for replication timed out" },
        };
        let (out, summary) = update_reply_outcome(&reply);
        assert_eq!((out.applied, out.failed), (0, 3));
        let summary = summary.unwrap();
        assert!(summary.starts_with("writeConcernError 64") && !summary.contains("email"), "{summary}");
        assert!(out.errors.iter().any(|e| e.contains("write concern")));
        let (out, summary) = update_reply_outcome(&doc! { "n": 1, "writeErrors": [{ "index": 0, "code": 66, "errmsg": "immutable _id" }] });
        assert_eq!((out.applied, out.failed, summary.as_deref()), (1, 1, Some("66 (1 failed)")));
    }

    #[tokio::test]
    async fn compare_cancel_flags_are_per_compare_and_leave_session_jobs_alone() {
        let state = state_with(&[("s1", "dev", false), ("s2", "dev", false)]).await;
        // An export on s1 has a pending cancel; starting and cancelling a compare must not reset or set it.
        state.request_cancel("s1", CancelScope::Job).await;
        let other_job = state.cancel_flag("s2", CancelScope::Job).await;
        let f1 = state.compare.begin_cancel("t1");
        let f2 = state.compare.begin_cancel("t2");
        state.compare.request_cancel("t1");
        assert!(f1.load(Ordering::Relaxed) && !f2.load(Ordering::Relaxed));
        assert!(!other_job.load(Ordering::Relaxed));
        // A compare that starts (and fails to reach the server) leaves the export's cancel pending.
        let _ = compare_run(&state, "t2", ns("s1", "a"), ns("s2", "a"), "_id", None, &[], |_| {}).await;
        assert!(state.cancel_flag("s1", CancelScope::Job).await.load(Ordering::Relaxed));
        // A new run gets a fresh flag.
        assert!(!state.compare.begin_cancel("t1").load(Ordering::Relaxed));
    }

    #[test]
    fn disk_use_only_from_wire_version_9_and_memory_errors_suggest_an_index() {
        assert!(!find_disk_use_supported(&doc! { "maxWireVersion": 8 })); // 4.2
        assert!(find_disk_use_supported(&doc! { "maxWireVersion": 9 })); // 4.4
        assert!(find_disk_use_supported(&doc! { "maxWireVersion": 21_i64 }));
        assert!(!find_disk_use_supported(&doc! {}));
        let n = ns("s1", "orders");
        let e42 = AppError::Server {
            code: 96,
            code_name: "OperationFailed".into(),
            message: "Executor error during find command :: caused by :: Sort operation used more than the maximum 33554432 bytes of RAM. Add an index, or specify a smaller limit.".into(),
        };
        let hint = sort_memory_hint(e42, "sku", &n).to_string();
        assert!(hint.contains("Create an index on `sku`") && hint.contains("shop.orders"), "{hint}");
        let e = sort_memory_hint(AppError::Server { code: 292, code_name: "QueryExceededMemoryLimitNoDiskUseAllowed".into(), message: "x".into() }, "k", &n);
        assert!(e.to_string().contains("index"), "{e}");
        let other = sort_memory_hint(AppError::Query("Duplicate key value".into()), "k", &n);
        assert_eq!(other.to_string(), "Query error: Duplicate key value");
    }

    #[test]
    fn queries_address_the_key_field_by_name() {
        assert_eq!(sort_spec("u.email"), doc! { "u.email": 1 });
        assert_eq!(in_filter("_id", &[Bson::Int32(1)]), doc! { "_id": { "$in": [1] } });
    }

    #[test]
    fn same_collection_and_bad_keys_are_rejected() {
        assert!(validate(&ns("s1", "a"), &ns("s1", "a"), "_id").is_err());
        validate(&ns("s1", "a"), &ns("s2", "a"), "_id").unwrap();
        validate(&ns("s1", "a"), &ns("s1", "b"), "u.email").unwrap();
        assert!(validate(&ns("s1", "a"), &ns("s1", "b"), "$where").is_err());
        assert!(validate(&ns("s1", "a"), &ns("s1", "b"), "a..b").is_err());
    }

    async fn state_with(sessions: &[(&str, &str, bool)]) -> AppState {
        let state = AppState::default();
        for (id, env, ro) in sessions {
            // Never connects: every refusal below happens before the first round trip.
            let client = Client::with_uri_str("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200").await.unwrap();
            state.insert_session(id.to_string(), crate::state::Session::new(client, *ro, format!("L-{id}"), env.to_string())).await;
        }
        state
    }

    #[tokio::test]
    async fn sync_into_prod_is_refused_without_confirmation_even_after_a_dry_run() {
        let state = state_with(&[("s1", "dev", false), ("s2", "prod", false)]).await;
        state.compare.record_dry_run(&plan(), SyncCounts::default(), Instant::now());
        let e = sync_run(&state, "t1", plan(), false, false, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("PROD"), "{e}");
        // The refusal did not consume the dry run.
        assert!(lock(&state.compare.dry_runs).contains_key(&plan().pair()));
    }

    #[tokio::test]
    async fn reversed_direction_checks_the_source_session_as_the_target() {
        // dst is PROD and read-only, src is a writable dev box: writing into src is allowed to pass the
        // guards, while the forward direction is refused as read-only.
        let state = state_with(&[("s1", "dev", false), ("s2", "prod", true)]).await;
        let e = sync_run(&state, "t1", plan(), true, true, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("read-only"), "{e}");
        let reversed = SyncPlan { direction: Direction::DstToSrc, ..plan() };
        let e = sync_run(&state, "t1", reversed, false, false, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("dry run"), "{e}");
        // And a PROD *source* being written to (reversed) needs confirmation.
        let state = state_with(&[("s1", "prod", false), ("s2", "dev", false)]).await;
        let reversed = SyncPlan { direction: Direction::DstToSrc, ..plan() };
        let e = sync_run(&state, "t1", reversed, false, false, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("PROD"), "{e}");
    }

    #[tokio::test]
    async fn real_sync_without_dry_run_is_refused() {
        let state = state_with(&[("s1", "dev", false), ("s2", "dev", false)]).await;
        let e = sync_run(&state, "t1", plan(), false, true, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("dry run"), "{e}");
        let e = sync_run(&state, "t1", SyncPlan { insert_missing: false, replace_different: false, ..plan() }, true, false, |_| {}).await.unwrap_err();
        assert!(e.to_string().contains("at least one"), "{e}");
    }

    /// End-to-end against a real server: `LUMIO_TEST_MONGO_URI=mongodb://localhost cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn compare_and_sync_two_real_collections() {
        let uri = std::env::var("LUMIO_TEST_MONGO_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let dir = std::env::temp_dir().join(format!("lumiong_sync_audit_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        state.audit.set_scope(crate::audit::AuditScope::All);
        state.insert_session("a".into(), crate::state::Session::new(Client::with_uri_str(&uri).await.unwrap(), false, "A".into(), "dev".into())).await;
        state.insert_session("b".into(), crate::state::Session::new(Client::with_uri_str(&uri).await.unwrap(), false, "B".into(), "prod".into())).await;
        let db = state.client("a").await.unwrap().database("lumio_sync_test");
        let _ = db.drop().await;
        let (src, dst) = (db.collection::<Document>("src"), db.collection::<Document>("dst"));
        let mut s: Vec<Document> = (0..2500).map(|i| doc! { "_id": i, "v": i, "updatedAt": 1 }).collect();
        s.push(doc! { "_id": "str", "v": 1 });
        src.insert_many(s).await.unwrap();
        let d: Vec<Document> = (1000..3000).map(|i| doc! { "updatedAt": 2, "v": if i % 100 == 0 { -1 } else { i }, "_id": i }).collect();
        dst.insert_many(d).await.unwrap();

        let p = SyncPlan {
            src: NsRef { session_id: "a".into(), db: "lumio_sync_test".into(), coll: "src".into() },
            dst: NsRef { session_id: "b".into(), db: "lumio_sync_test".into(), coll: "dst".into() },
            key: "_id".into(),
            filter: None,
            ignore_fields: vec!["updatedAt".into()],
            insert_missing: true,
            replace_different: true,
            delete_extra: true,
            direction: Direction::SrcToDst,
        };
        let summary = compare_run(&state, "t1", p.src.clone(), p.dst.clone(), "_id", None, &p.ignore_fields, |_| {}).await.unwrap();
        assert_eq!(summary, DiffSummary { only_src: 1001, only_dst: 500, different: 15, same: 1485, truncated: false });
        let page = compare_page_run(&state, "t1", DiffKind::Different, 0, 10).await.unwrap();
        assert_eq!(page.total, 15);
        assert!(page.rows.iter().all(|r| r.src.is_some() && r.dst.is_some()));

        let dry = sync_run(&state, "t1", p.clone(), true, false, |_| {}).await.unwrap();
        assert_eq!((dry.planned.insert, dry.planned.replace, dry.planned.delete), (1001, 15, 500));
        assert_eq!(dst.count_documents(doc! {}).await.unwrap(), 2000, "dry run wrote nothing");
        // PROD destination: refused without confirmation, applied with it.
        assert!(sync_run(&state, "t1", p.clone(), false, false, |_| {}).await.is_err());
        let real = sync_run(&state, "t1", p.clone(), false, true, |_| {}).await.unwrap();
        assert_eq!((real.applied.insert, real.applied.replace, real.applied.delete, real.failed), (1001, 15, 500, 0));
        let after = compare_run(&state, "t1", p.src.clone(), p.dst.clone(), "_id", None, &p.ignore_fields, |_| {}).await.unwrap();
        assert_eq!((after.only_src, after.only_dst, after.different), (0, 0, 0));
        let audit = state.audit.query(0, i64::MAX, None).unwrap();
        assert!(audit.iter().all(|e| e.source == "sync" && e.ns == "lumio_sync_test.dst" && e.ok));
        assert_eq!(audit.iter().filter_map(|e| e.count).sum::<u64>(), 1001 + 15 + 500);

        // An export's pending cancel on either session survives a compare (per-compare flags).
        state.request_cancel("a", crate::state::CancelScope::Job).await;
        compare_run(&state, "t1", p.src.clone(), p.dst.clone(), "_id", None, &p.ignore_fields, |_| {}).await.unwrap();
        assert!(state.cancel_flag("a", crate::state::CancelScope::Job).await.load(Ordering::Relaxed));

        // _id int vs long on the two sides: reported as a type change, never replaced.
        src.insert_one(doc! { "_id": 5000_i32, "v": 1 }).await.unwrap();
        dst.insert_one(doc! { "_id": 5000_i64, "v": 2 }).await.unwrap();
        let only_replace = SyncPlan { insert_missing: false, delete_extra: false, ..p.clone() };
        let dry = sync_run(&state, "t1", only_replace.clone(), true, false, |_| {}).await.unwrap();
        assert_eq!((dry.planned.replace, dry.type_conflicts), (0, 1));
        let real = sync_run(&state, "t1", only_replace, false, true, |_| {}).await.unwrap();
        assert_eq!((real.applied.replace, real.type_conflicts), (0, 1));
        assert_eq!(dst.find_one(doc! { "_id": 5000 }).await.unwrap().unwrap().get_i32("v").unwrap(), 2);
        src.delete_one(doc! { "_id": 5000 }).await.unwrap();
        dst.delete_one(doc! { "_id": 5000 }).await.unwrap();

        // The dry run bounds the change: the source shrinks after it, so more deletes than announced are refused.
        dst.insert_many((10_000..10_003).map(|i| doc! { "_id": i })).await.unwrap();
        let dry = sync_run(&state, "t1", p.clone(), true, false, |_| {}).await.unwrap();
        assert_eq!(dry.planned.delete, 3);
        src.delete_many(doc! { "_id": { "$in": [0, 1] } }).await.unwrap();
        let e = sync_run(&state, "t1", p.clone(), false, true, |_| {}).await.unwrap_err().to_string();
        assert!(e.contains("changed since the dry run") && e.contains("2 more deletes"), "{e}");
        assert_eq!(dst.count_documents(doc! {}).await.unwrap(), 2501 + 3, "nothing deleted");

        // A case-insensitive default collation does not reorder string keys (simple collation on the finds).
        let ci = mongodb::options::Collation::builder().locale("en").strength(mongodb::options::CollationStrength::Secondary).build();
        db.create_collection("ci_src").collation(ci.clone()).await.unwrap();
        db.create_collection("ci_dst").collation(ci).await.unwrap();
        db.collection::<Document>("ci_src").insert_many([doc! { "_id": "a" }, doc! { "_id": "B" }, doc! { "_id": "c" }]).await.unwrap();
        db.collection::<Document>("ci_dst").insert_many([doc! { "_id": "a" }, doc! { "_id": "c" }]).await.unwrap();
        let ns2 = |coll: &str, sid: &str| NsRef { session_id: sid.into(), db: "lumio_sync_test".into(), coll: coll.into() };
        let s = compare_run(&state, "t2", ns2("ci_src", "a"), ns2("ci_dst", "b"), "_id", None, &[], |_| {}).await.unwrap();
        assert_eq!((s.only_src, s.same), (1, 2));

        // ~40 MB sorted by an unindexed key: 4.4+ spills to disk (allowDiskUse); 4.2 (no allowDiskUse,
        // 32 MB in-memory sort cap) must fail with the index advice, and works once the index exists.
        let pad = "x".repeat(100_000);
        let big = db.collection::<Document>("big");
        big.insert_many((0..400).map(|i| doc! { "k": 400 - i, "pad": pad.clone() })).await.unwrap();
        db.collection::<Document>("big2").insert_one(doc! { "k": 1, "pad": "" }).await.unwrap();
        let hello = db.run_command(doc! { "isMaster": 1 }).await.unwrap();
        let r = compare_run(&state, "t3", ns2("big", "a"), ns2("big2", "b"), "k", None, &[], |_| {}).await;
        if find_disk_use_supported(&hello) {
            let s = r.unwrap();
            assert_eq!((s.only_src, s.different), (399, 1));
        } else {
            let e = r.unwrap_err().to_string();
            assert!(e.contains("Create an index on `k`"), "{e}");
            big.create_index(mongodb::IndexModel::builder().keys(doc! { "k": 1 }).build()).await.unwrap();
            let s = compare_run(&state, "t3", ns2("big", "a"), ns2("big2", "b"), "k", None, &[], |_| {}).await.unwrap();
            assert_eq!((s.only_src, s.different), (399, 1));
        }
        let _ = db.drop().await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
