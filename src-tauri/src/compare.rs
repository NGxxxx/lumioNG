//! Streaming comparison of two collections: a merge-join over two cursors sorted by the same key,
//! holding one document per side at a time (O(1) memory). Documents are compared as normalized
//! BSON bytes (keys sorted recursively, optional ignored fields removed), so field order never
//! counts as a change. Also the write side of data sync ([`run_sync`]), driven by the same join.
//!
//! Pairing safety: keys are compared with MongoDB's BSON sort order ([`cmp_key`]). Every key read
//! from a side must be strictly greater than the previous one from that side; anything else (a
//! duplicate key, or an order this comparator disagrees with) aborts the merge instead of guessing,
//! so two documents are never mis-paired. Key types whose server order is not modeled exactly
//! (arrays at the top level, Decimal128, JavaScript, DBPointer, undefined) are refused up front.

use crate::error::AppError;
use futures::{Stream, StreamExt};
use mongodb::bson::{Bson, Document};
use std::cmp::Ordering;

/// At most this many differing keys are kept for browsing; past it, differences are only counted.
pub const MAX_DIFF_KEYS: usize = 100_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffKind {
    OnlySrc,
    OnlyDst,
    Different,
    /// Only seen inside the join; never stored or reported as an item.
    Same,
}

/// One step of the join. The documents are moved out of the cursors, so carrying them costs nothing.
#[derive(Debug, Clone)]
pub struct DiffItem {
    pub kind: DiffKind,
    pub key: Bson,
    pub src: Option<Document>,
    pub dst: Option<Document>,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub only_src: u64,
    pub only_dst: u64,
    pub different: u64,
    pub same: u64,
    /// More differences than `cap`: the counts are complete, the stored key list is not.
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct DiffOptions {
    /// Field (dotted path allowed) both cursors are sorted by; `_id` by default.
    pub key: String,
    /// Fields (dotted paths) left out of the comparison, e.g. `updatedAt`.
    pub ignore_fields: Vec<String>,
    /// How many differing keys `merge_diff` hands to `on_item` (normally [`MAX_DIFF_KEYS`]).
    pub cap: usize,
}

// ── key order ──

/// Canonical BSON sort order of the types this comparator handles; `None` = not supported as a key.
fn type_rank(b: &Bson) -> Option<u8> {
    Some(match b {
        Bson::MinKey => 1,
        Bson::Null => 2,
        Bson::Int32(_) | Bson::Int64(_) | Bson::Double(_) => 3,
        Bson::String(_) | Bson::Symbol(_) => 4,
        Bson::Document(_) => 5,
        Bson::Array(_) => 6,
        Bson::Binary(_) => 7,
        Bson::ObjectId(_) => 8,
        Bson::Boolean(_) => 9,
        Bson::DateTime(_) => 10,
        Bson::Timestamp(_) => 11,
        Bson::RegularExpression(_) => 12,
        Bson::MaxKey => 13,
        _ => return None,
    })
}

/// `i` against `f` exactly (no rounding of `i` to f64). NaN sorts below every number, as on the server.
fn cmp_int_double(i: i64, f: f64) -> Ordering {
    if f.is_nan() {
        return Ordering::Greater;
    }
    if f >= 9_223_372_036_854_775_808.0 {
        return Ordering::Less;
    }
    if f < -9_223_372_036_854_775_808.0 {
        return Ordering::Greater;
    }
    let t = f.trunc();
    match i.cmp(&(t as i64)) {
        Ordering::Equal if f > t => Ordering::Less,
        Ordering::Equal if f < t => Ordering::Greater,
        o => o,
    }
}

fn cmp_double(a: f64, b: f64) -> Ordering {
    match (a.is_nan(), b.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.partial_cmp(&b).unwrap_or(Ordering::Equal),
    }
}

fn cmp_number(a: &Bson, b: &Bson) -> Ordering {
    let int = |v: &Bson| match v {
        Bson::Int32(n) => Some(*n as i64),
        Bson::Int64(n) => Some(*n),
        _ => None,
    };
    let dbl = |v: &Bson| match v {
        Bson::Double(d) => *d,
        _ => f64::NAN,
    };
    match (int(a), int(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(x), None) => cmp_int_double(x, dbl(b)),
        (None, Some(y)) => cmp_int_double(y, dbl(a)).reverse(),
        (None, None) => cmp_double(dbl(a), dbl(b)),
    }
}

/// Element-wise comparison used inside objects and nested arrays: type, then name, then value; shorter first.
fn cmp_elements<'a>(
    a: impl Iterator<Item = (&'a str, &'a Bson)>,
    mut b: impl Iterator<Item = (&'a str, &'a Bson)>,
) -> Option<Ordering> {
    for (ka, va) in a {
        let Some((kb, vb)) = b.next() else { return Some(Ordering::Greater) };
        let o = type_rank(va)?.cmp(&type_rank(vb)?).then_with(|| ka.as_bytes().cmp(kb.as_bytes()));
        if o != Ordering::Equal {
            return Some(o);
        }
        let o = cmp_value(va, vb)?;
        if o != Ordering::Equal {
            return Some(o);
        }
    }
    Some(if b.next().is_some() { Ordering::Less } else { Ordering::Equal })
}

fn cmp_value(a: &Bson, b: &Bson) -> Option<Ordering> {
    let (ra, rb) = (type_rank(a)?, type_rank(b)?);
    if ra != rb {
        return Some(ra.cmp(&rb));
    }
    Some(match (a, b) {
        (Bson::MinKey, Bson::MinKey) | (Bson::Null, Bson::Null) | (Bson::MaxKey, Bson::MaxKey) => Ordering::Equal,
        (Bson::String(x) | Bson::Symbol(x), Bson::String(y) | Bson::Symbol(y)) => x.as_bytes().cmp(y.as_bytes()),
        (Bson::Document(x), Bson::Document(y)) => {
            return cmp_elements(x.iter().map(|(k, v)| (k.as_str(), v)), y.iter().map(|(k, v)| (k.as_str(), v)));
        }
        (Bson::Array(x), Bson::Array(y)) => {
            // Nested arrays (inside an object key) compare like documents with keys "0", "1", …
            return cmp_elements(x.iter().map(|v| ("", v)), y.iter().map(|v| ("", v)));
        }
        (Bson::Binary(x), Bson::Binary(y)) => x
            .bytes
            .len()
            .cmp(&y.bytes.len())
            .then_with(|| u8::from(x.subtype).cmp(&u8::from(y.subtype)))
            .then_with(|| x.bytes.cmp(&y.bytes)),
        (Bson::ObjectId(x), Bson::ObjectId(y)) => x.bytes().cmp(&y.bytes()),
        (Bson::Boolean(x), Bson::Boolean(y)) => x.cmp(y),
        (Bson::DateTime(x), Bson::DateTime(y)) => x.timestamp_millis().cmp(&y.timestamp_millis()),
        (Bson::Timestamp(x), Bson::Timestamp(y)) => (x.time, x.increment).cmp(&(y.time, y.increment)),
        (Bson::RegularExpression(x), Bson::RegularExpression(y)) => {
            x.pattern.as_bytes().cmp(y.pattern.as_bytes()).then_with(|| x.options.as_bytes().cmp(y.options.as_bytes()))
        }
        _ if ra == 3 => cmp_number(a, b),
        _ => return None,
    })
}

/// MongoDB ascending sort order of two key values, or `None` when either is (or contains) a type
/// this comparator does not model; callers abort in that case rather than risk a wrong pairing.
pub fn cmp_key(a: &Bson, b: &Bson) -> Option<Ordering> {
    if matches!(a, Bson::Array(_)) || matches!(b, Bson::Array(_)) {
        return None;
    }
    cmp_value(a, b)
}

/// The value at a dotted `path`; arrays along the path (or as the value) are refused.
pub(crate) fn key_of(doc: &Document, path: &str) -> Result<Bson, AppError> {
    let mut cur = doc;
    let mut parts = path.split('.').peekable();
    while let Some(p) = parts.next() {
        let v = cur.get(p).ok_or_else(|| AppError::Query(format!("A document has no `{path}` field; every document must have the comparison key.")))?;
        if parts.peek().is_none() {
            return match v {
                Bson::Array(_) => Err(AppError::Query(format!("The key `{path}` holds an array; array keys cannot be compared."))),
                v if cmp_key(v, v).is_none() => Err(AppError::Query(format!(
                    "The key `{path}` holds a value type that is not supported for comparison (Decimal128, JavaScript, DBPointer or undefined)."
                ))),
                v => Ok(v.clone()),
            };
        }
        cur = match v {
            Bson::Document(d) => d,
            Bson::Array(_) => return Err(AppError::Query(format!("The key `{path}` goes through an array; array keys cannot be compared."))),
            _ => return Err(AppError::Query(format!("A document has no `{path}` field; every document must have the comparison key."))),
        };
    }
    Err(AppError::Query("The comparison key is empty.".into()))
}

// ── normalization ──

/// `doc` with keys sorted at every depth (inside arrays too; array order is kept) and `ignore` paths removed.
fn sorted(doc: &Document, ignore: &[Vec<&str>]) -> Document {
    let mut entries: Vec<(&String, &Bson)> = doc
        .iter()
        .filter(|(k, _)| !ignore.iter().any(|p| p.len() == 1 && p[0] == k.as_str()))
        .collect();
    entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    entries
        .into_iter()
        .map(|(k, v)| {
            let sub: Vec<Vec<&str>> = ignore.iter().filter(|p| p.len() > 1 && p[0] == k.as_str()).map(|p| p[1..].to_vec()).collect();
            (k.clone(), sorted_value(v, &sub))
        })
        .collect()
}

fn sorted_value(v: &Bson, ignore: &[Vec<&str>]) -> Bson {
    match v {
        Bson::Document(d) => Bson::Document(sorted(d, ignore)),
        Bson::Array(items) => Bson::Array(items.iter().map(|i| sorted_value(i, &[])).collect()),
        other => other.clone(),
    }
}

/// The bytes two documents are compared by.
pub fn normalized_bytes(doc: &Document, ignore: &[Vec<&str>]) -> Result<Vec<u8>, AppError> {
    mongodb::bson::to_vec(&sorted(doc, ignore)).map_err(|e| AppError::Serialize(e.to_string()))
}

// ── the join ──

struct Side<S> {
    stream: S,
    head: Option<(Bson, Document)>,
    last: Option<Bson>,
    done: bool,
    name: &'static str,
    read: u64,
}

impl<S: Stream<Item = Result<Document, AppError>> + Unpin> Side<S> {
    fn new(stream: S, name: &'static str) -> Self {
        Side { stream, head: None, last: None, done: false, name, read: 0 }
    }

    async fn fill(&mut self, key: &str) -> Result<(), AppError> {
        if self.head.is_some() || self.done {
            return Ok(());
        }
        match self.stream.next().await {
            None => self.done = true,
            Some(doc) => {
                let doc = doc?;
                let k = key_of(&doc, key)?;
                if let Some(prev) = &self.last {
                    match cmp_key(prev, &k) {
                        Some(Ordering::Less) => {}
                        Some(Ordering::Equal) => {
                            return Err(AppError::Query(format!(
                                "Duplicate key value in the {} collection: `{key}` must be unique on both sides.",
                                self.name
                            )))
                        }
                        _ => {
                            return Err(AppError::Query(format!(
                                "The {} cursor is not sorted the way the comparison expects on `{key}` (a collation on the collection can cause this); stopped so no documents are paired wrongly.",
                                self.name
                            )))
                        }
                    }
                }
                self.last = Some(k.clone());
                self.read += 1;
                self.head = Some((k, doc));
            }
        }
        Ok(())
    }
}

/// The merge-join as a pull iterator: [`MergeJoin::next`] yields every key once, `Same` included.
pub struct MergeJoin<S, D> {
    src: Side<S>,
    dst: Side<D>,
    key: String,
    ignore: Vec<String>,
}

impl<S, D> MergeJoin<S, D>
where
    S: Stream<Item = Result<Document, AppError>> + Unpin,
    D: Stream<Item = Result<Document, AppError>> + Unpin,
{
    /// When the key is not `_id`, `_id` is left out of the comparison too: documents are matched by
    /// the key, and their `_id`s are expected to differ between deployments.
    pub fn new(src: S, dst: D, key: &str, ignore_fields: &[String]) -> Self {
        let mut ignore: Vec<String> = ignore_fields.iter().map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect();
        if key != "_id" && !ignore.iter().any(|f| f == "_id") {
            ignore.push("_id".into());
        }
        MergeJoin { src: Side::new(src, "source"), dst: Side::new(dst, "destination"), key: key.to_string(), ignore }
    }

    /// Documents read so far from (source, destination).
    pub fn read(&self) -> (u64, u64) {
        (self.src.read, self.dst.read)
    }

    pub async fn next(&mut self) -> Result<Option<DiffItem>, AppError> {
        self.src.fill(&self.key).await?;
        self.dst.fill(&self.key).await?;
        let order = match (&self.src.head, &self.dst.head) {
            (None, None) => return Ok(None),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (Some((a, _)), Some((b, _))) => cmp_key(a, b).ok_or_else(|| AppError::Query("Key values cannot be compared.".into()))?,
        };
        Ok(Some(match order {
            Ordering::Less => {
                let (key, doc) = self.src.head.take().ok_or(AppError::Query("merge state".into()))?;
                DiffItem { kind: DiffKind::OnlySrc, key, src: Some(doc), dst: None }
            }
            Ordering::Greater => {
                let (key, doc) = self.dst.head.take().ok_or(AppError::Query("merge state".into()))?;
                DiffItem { kind: DiffKind::OnlyDst, key, src: None, dst: Some(doc) }
            }
            Ordering::Equal => {
                let (key, a) = self.src.head.take().ok_or(AppError::Query("merge state".into()))?;
                let (_, b) = self.dst.head.take().ok_or(AppError::Query("merge state".into()))?;
                let paths: Vec<Vec<&str>> = self.ignore.iter().map(|f| f.split('.').collect()).collect();
                let same = normalized_bytes(&a, &paths)? == normalized_bytes(&b, &paths)?;
                DiffItem { kind: if same { DiffKind::Same } else { DiffKind::Different }, key, src: Some(a), dst: Some(b) }
            }
        }))
    }
}

/// Tallies one join step into `summary`.
fn count(summary: &mut DiffSummary, kind: DiffKind) {
    match kind {
        DiffKind::OnlySrc => summary.only_src += 1,
        DiffKind::OnlyDst => summary.only_dst += 1,
        DiffKind::Different => summary.different += 1,
        DiffKind::Same => summary.same += 1,
    }
}

/// Compares two key-sorted streams. `on_item` receives the first `opts.cap` differences (never
/// `Same`); `tick` gets the number of documents read so far after every step and may return an
/// error (e.g. cancelled) to stop.
pub async fn merge_diff<S, D>(
    src: S,
    dst: D,
    opts: &DiffOptions,
    mut on_item: impl FnMut(DiffItem),
    mut tick: impl FnMut(u64) -> Result<(), AppError>,
) -> Result<DiffSummary, AppError>
where
    S: Stream<Item = Result<Document, AppError>> + Unpin,
    D: Stream<Item = Result<Document, AppError>> + Unpin,
{
    let mut join = MergeJoin::new(src, dst, &opts.key, &opts.ignore_fields);
    let mut summary = DiffSummary::default();
    let mut kept = 0usize;
    while let Some(item) = join.next().await? {
        count(&mut summary, item.kind);
        if item.kind != DiffKind::Same {
            if kept < opts.cap {
                kept += 1;
                on_item(item);
            } else {
                summary.truncated = true;
            }
        }
        let (a, b) = join.read();
        tick(a + b)?;
    }
    Ok(summary)
}

// ── sync ──

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFlags {
    pub insert_missing: bool,
    pub replace_different: bool,
    pub delete_extra: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCounts {
    pub insert: u64,
    pub replace: u64,
    pub delete: u64,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub dry_run: bool,
    /// What the plan calls for (in a dry run: what would be written).
    pub planned: SyncCounts,
    /// What the server reports as written (always zero in a dry run).
    pub applied: SyncCounts,
    pub failed: u64,
    /// First few write errors, for the user.
    pub errors: Vec<String>,
    pub summary: DiffSummary,
    /// Stopped by the user; batches already sent stay written.
    pub cancelled: bool,
    /// Planned writes that neither applied nor failed: the target changed meanwhile (e.g. a document
    /// to replace was already gone). `planned - applied - failed`; 0 for a dry or cancelled run.
    pub skipped: u64,
    /// Pairs matched by `_id` whose `_id` values have different BSON types (e.g. int vs long): a
    /// replace cannot change `_id` in place, so they are left alone and not planned.
    pub type_conflicts: u64,
}

/// What one write batch did. `Err` from a sink method is fatal and stops the sync.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BatchOutcome {
    pub applied: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// Where sync writes go: the real one talks to MongoDB and audits each batch; tests record calls.
pub trait SyncSink {
    fn insert(&mut self, docs: Vec<Document>) -> impl std::future::Future<Output = Result<BatchOutcome, AppError>> + Send;
    /// `(target _id, replacement)` pairs.
    fn replace(&mut self, docs: Vec<(Bson, Document)>) -> impl std::future::Future<Output = Result<BatchOutcome, AppError>> + Send;
    fn delete(&mut self, ids: Vec<Bson>) -> impl std::future::Future<Output = Result<BatchOutcome, AppError>> + Send;
}

/// Documents per write batch.
pub const SYNC_BATCH: usize = 1000;

/// A batch is also sent once its documents reach this many bytes, keeping each write command well
/// under the 16 MB command limit.
const SYNC_BATCH_BYTES: usize = 8 * 1024 * 1024;
const MAX_REPORTED_ERRORS: usize = 5;

#[derive(Default)]
struct Pending {
    insert: Vec<Document>,
    replace: Vec<(Bson, Document)>,
    delete: Vec<Bson>,
    insert_bytes: usize,
    replace_bytes: usize,
}

fn doc_len(d: &Document) -> usize {
    mongodb::bson::to_vec(d).map(|v| v.len()).unwrap_or(0)
}

impl SyncReport {
    fn absorb(&mut self, which: fn(&mut SyncCounts) -> &mut u64, out: BatchOutcome) {
        *which(&mut self.applied) += out.applied;
        self.failed += out.failed;
        for e in out.errors {
            if self.errors.len() < MAX_REPORTED_ERRORS {
                self.errors.push(e);
            }
        }
    }

    fn written(&self) -> u64 {
        self.applied.insert + self.applied.replace + self.applied.delete
    }

    fn note(&mut self, msg: String) {
        if self.errors.len() < MAX_REPORTED_ERRORS {
            self.errors.push(msg);
        }
    }
}

impl SyncCounts {
    fn total(&self) -> u64 {
        self.insert + self.replace + self.delete
    }
}

async fn flush_inserts<K: SyncSink>(p: &mut Pending, sink: &mut K, r: &mut SyncReport) -> Result<(), AppError> {
    if !p.insert.is_empty() {
        let out = sink.insert(std::mem::take(&mut p.insert)).await?;
        r.absorb(|c| &mut c.insert, out);
        p.insert_bytes = 0;
    }
    Ok(())
}

async fn flush_replaces<K: SyncSink>(p: &mut Pending, sink: &mut K, r: &mut SyncReport) -> Result<(), AppError> {
    if !p.replace.is_empty() {
        let out = sink.replace(std::mem::take(&mut p.replace)).await?;
        r.absorb(|c| &mut c.replace, out);
        p.replace_bytes = 0;
    }
    Ok(())
}

async fn flush_deletes<K: SyncSink>(p: &mut Pending, sink: &mut K, r: &mut SyncReport) -> Result<(), AppError> {
    if !p.delete.is_empty() {
        let out = sink.delete(std::mem::take(&mut p.delete)).await?;
        r.absorb(|c| &mut c.delete, out);
    }
    Ok(())
}

/// The target document's `_id`, which every replace and delete is addressed by.
fn target_id(doc: Option<&Document>) -> Option<Bson> {
    doc.and_then(|d| d.get("_id")).cloned()
}

/// Planned operations beyond `limits`, per kind.
fn over(planned: &SyncCounts, limits: &SyncCounts) -> SyncCounts {
    SyncCounts {
        insert: planned.insert.saturating_sub(limits.insert),
        replace: planned.replace.saturating_sub(limits.replace),
        delete: planned.delete.saturating_sub(limits.delete),
    }
}

/// Makes the target collection match the source for the enabled operations: documents only in the
/// source are inserted, differing ones replaced with the source version, ones only in the target
/// deleted. The join's "src" is the side read from, "dst" the side written to (the caller resolves
/// the direction). A dry run walks the same join and counts, but never calls `sink`.
///
/// `limits` (the dry run's planned counts) are per-operation ceilings for a real run: the moment one
/// would be passed, nothing more is written (unsent batches are dropped), the rest of the join is
/// only counted, and the run fails with the extra operations by kind and what was already written.
///
/// `tick(read, written)` runs after every step; returning `false` stops (report `cancelled`), leaving
/// batches already sent in place and dropping the unsent remainder.
pub async fn run_sync<S, D, K>(
    mut join: MergeJoin<S, D>,
    flags: SyncFlags,
    key_is_id: bool,
    dry_run: bool,
    limits: Option<SyncCounts>,
    sink: &mut K,
    mut tick: impl FnMut(u64, u64) -> bool,
) -> Result<SyncReport, AppError>
where
    S: Stream<Item = Result<Document, AppError>> + Unpin,
    D: Stream<Item = Result<Document, AppError>> + Unpin,
    K: SyncSink,
{
    let mut r = SyncReport { dry_run, ..Default::default() };
    let mut p = Pending::default();
    // Set once a ceiling is passed: from then on the join is only counted.
    let mut halted = dry_run;
    let res: Result<(), AppError> = async {
        loop {
            let (a, b) = join.read();
            if !tick(a + b, r.written()) {
                r.cancelled = true;
                return Ok(());
            }
            let Some(item) = join.next().await? else { break };
            count(&mut r.summary, item.kind);
            let wanted = match item.kind {
                DiffKind::OnlySrc => flags.insert_missing,
                DiffKind::Different => flags.replace_different,
                DiffKind::OnlyDst => flags.delete_extra,
                DiffKind::Same => false,
            };
            if !wanted {
                continue;
            }
            if item.kind == DiffKind::Different && key_is_id {
                let ty = |d: &Option<Document>| d.as_ref().and_then(|d| d.get("_id")).map(|v| v.element_type());
                if ty(&item.src) != ty(&item.dst) {
                    r.type_conflicts += 1;
                    let key = crate::bson_json::bson_to_canonical_string(&item.key).unwrap_or_default();
                    r.note(format!("_id {key}: type change — cannot replace in place (skipped)"));
                    continue;
                }
            }
            match item.kind {
                DiffKind::OnlySrc => r.planned.insert += 1,
                DiffKind::Different => r.planned.replace += 1,
                _ => r.planned.delete += 1,
            }
            if !halted {
                if let Some(l) = &limits {
                    if over(&r.planned, l).total() > 0 {
                        halted = true;
                        p = Pending::default();
                    }
                }
            }
            if halted {
                continue;
            }
            match item.kind {
                DiffKind::OnlySrc => {
                    let Some(doc) = item.src else { continue };
                    p.insert_bytes += doc_len(&doc);
                    p.insert.push(doc);
                    if p.insert.len() >= SYNC_BATCH || p.insert_bytes >= SYNC_BATCH_BYTES {
                        flush_inserts(&mut p, sink, &mut r).await?;
                    }
                }
                DiffKind::Different => {
                    let (Some(id), Some(mut doc)) = (target_id(item.dst.as_ref()), item.src) else {
                        r.absorb(|c| &mut c.replace, BatchOutcome { applied: 0, failed: 1, errors: vec!["destination document has no _id".into()] });
                        continue;
                    };
                    // Matched by another key: the target keeps its own _id.
                    if !key_is_id {
                        doc.remove("_id");
                    }
                    p.replace_bytes += doc_len(&doc);
                    p.replace.push((id, doc));
                    if p.replace.len() >= SYNC_BATCH || p.replace_bytes >= SYNC_BATCH_BYTES {
                        flush_replaces(&mut p, sink, &mut r).await?;
                    }
                }
                _ => {
                    let Some(id) = target_id(item.dst.as_ref()) else {
                        r.absorb(|c| &mut c.delete, BatchOutcome { applied: 0, failed: 1, errors: vec!["destination document has no _id".into()] });
                        continue;
                    };
                    p.delete.push(id);
                    if p.delete.len() >= SYNC_BATCH {
                        flush_deletes(&mut p, sink, &mut r).await?;
                    }
                }
            }
        }
        if !halted {
            flush_inserts(&mut p, sink, &mut r).await?;
            flush_replaces(&mut p, sink, &mut r).await?;
            flush_deletes(&mut p, sink, &mut r).await?;
        }
        Ok(())
    }
    .await;
    let written = || {
        format!("Already written: {} inserted, {} replaced, {} deleted.", r.applied.insert, r.applied.replace, r.applied.delete)
    };
    if let Err(e) = res {
        return Err(if r.written() == 0 { e } else { AppError::Query(format!("{e} — stopped. {}", written())) });
    }
    if let (false, false, Some(l)) = (dry_run, r.cancelled, &limits) {
        let x = over(&r.planned, l);
        if x.total() > 0 {
            return Err(AppError::Query(format!(
                "The data changed since the dry run: {} more inserts, {} more replaces, {} more deletes than it announced. \
                 Nothing further was written; run the dry run again. {}",
                x.insert,
                x.replace,
                x.delete,
                written()
            )));
        }
    }
    if !dry_run && !r.cancelled {
        r.skipped = r.planned.total().saturating_sub(r.written() + r.failed);
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId};

    fn st(docs: Vec<Document>) -> impl Stream<Item = Result<Document, AppError>> + Unpin {
        futures::stream::iter(docs.into_iter().map(Ok))
    }

    fn opts(key: &str, ignore: &[&str]) -> DiffOptions {
        DiffOptions { key: key.into(), ignore_fields: ignore.iter().map(|s| s.to_string()).collect(), cap: MAX_DIFF_KEYS }
    }

    async fn run(src: Vec<Document>, dst: Vec<Document>, o: &DiffOptions) -> Result<(DiffSummary, Vec<(DiffKind, Bson)>), AppError> {
        let mut items = Vec::new();
        let s = merge_diff(st(src), st(dst), o, |it| items.push((it.kind, it.key)), |_| Ok(())).await?;
        Ok((s, items))
    }

    #[tokio::test]
    async fn merge_detects_only_src_only_dst_and_changed() {
        let src = vec![doc! {"_id": 1, "a": 1}, doc! {"_id": 2, "a": 2}, doc! {"_id": 4, "a": 4}, doc! {"_id": 5, "a": 5}];
        let dst = vec![doc! {"_id": 2, "a": 2}, doc! {"_id": 3, "a": 3}, doc! {"_id": 4, "a": 40}, doc! {"_id": 6, "a": 6}];
        let (s, items) = run(src, dst, &opts("_id", &[])).await.unwrap();
        assert_eq!(s, DiffSummary { only_src: 2, only_dst: 2, different: 1, same: 1, truncated: false });
        assert_eq!(
            items,
            vec![
                (DiffKind::OnlySrc, Bson::Int32(1)),
                (DiffKind::OnlyDst, Bson::Int32(3)),
                (DiffKind::Different, Bson::Int32(4)),
                (DiffKind::OnlySrc, Bson::Int32(5)),
                (DiffKind::OnlyDst, Bson::Int32(6)),
            ]
        );
    }

    #[tokio::test]
    async fn key_order_in_documents_does_not_count_as_change() {
        let src = vec![doc! {"_id": 1, "a": 1, "b": {"x": 1, "y": [ {"p": 1, "q": 2} ]}}];
        let dst = vec![doc! {"b": {"y": [ {"q": 2, "p": 1} ], "x": 1}, "a": 1, "_id": 1}];
        let (s, items) = run(src, dst, &opts("_id", &[])).await.unwrap();
        assert_eq!((s.same, s.different), (1, 0));
        assert!(items.is_empty());
        // …but array order and value types still do.
        let (s, _) = run(vec![doc! {"_id": 1, "t": [1, 2]}], vec![doc! {"_id": 1, "t": [2, 1]}], &opts("_id", &[])).await.unwrap();
        assert_eq!(s.different, 1);
        let (s, _) = run(vec![doc! {"_id": 1, "n": 5_i32}], vec![doc! {"_id": 1, "n": 5_i64}], &opts("_id", &[])).await.unwrap();
        assert_eq!(s.different, 1);
    }

    #[tokio::test]
    async fn ignored_fields_are_skipped() {
        let src = vec![doc! {"_id": 1, "a": 1, "updatedAt": 10, "meta": {"seen": 1, "v": 1}}];
        let dst = vec![doc! {"_id": 1, "a": 1, "updatedAt": 99, "meta": {"seen": 2, "v": 1}}];
        let (s, _) = run(src.clone(), dst.clone(), &opts("_id", &["updatedAt", "meta.seen"])).await.unwrap();
        assert_eq!((s.same, s.different), (1, 0));
        let (s, _) = run(src, dst, &opts("_id", &["updatedAt"])).await.unwrap();
        assert_eq!((s.same, s.different), (0, 1));
    }

    #[tokio::test]
    async fn truncates_after_cap_but_keeps_counts() {
        let src: Vec<Document> = (0..10).map(|i| doc! {"_id": i, "v": i}).collect();
        let dst: Vec<Document> = (5..15).map(|i| doc! {"_id": i, "v": if i == 7 { 70 } else { i }}).collect();
        let mut o = opts("_id", &[]);
        o.cap = 3;
        let (s, items) = run(src.clone(), dst.clone(), &o).await.unwrap();
        assert_eq!(s, DiffSummary { only_src: 5, only_dst: 5, different: 1, same: 4, truncated: true });
        assert_eq!(items.len(), 3);
        // The real cap.
        let big: Vec<Document> = (0..(MAX_DIFF_KEYS as i64 + 7)).map(|i| doc! {"_id": i}).collect();
        let (s, items) = run(big, vec![], &opts("_id", &[])).await.unwrap();
        assert_eq!(s.only_src, MAX_DIFF_KEYS as u64 + 7);
        assert!(s.truncated);
        assert_eq!(items.len(), MAX_DIFF_KEYS);
        // Exactly at the cap is not truncated.
        let (s, items) = run(src, dst, &DiffOptions { cap: 11, ..opts("_id", &[]) }).await.unwrap();
        assert!(!s.truncated);
        assert_eq!(items.len(), 11);
    }

    #[tokio::test]
    async fn mixed_key_types_pair_in_bson_sort_order() {
        // Server order for _id ascending: MinKey < null < numbers < strings < objects < binData < ObjectId < bool < date < MaxKey.
        let oid = ObjectId::parse_str("65a000000000000000000001").unwrap();
        let date = mongodb::bson::DateTime::from_millis(5);
        let keys = |extra: bool| -> Vec<Bson> {
            let mut v = vec![
                Bson::MinKey,
                Bson::Null,
                Bson::Double(-1.5),
                Bson::Int32(1),
                Bson::Double(1.5),
                Bson::Int64(2),
                Bson::String("a".into()),
                Bson::String("b".into()),
                Bson::Document(doc! {"x": 1}),
                Bson::ObjectId(oid),
                Bson::Boolean(false),
                Bson::Boolean(true),
                Bson::DateTime(date),
                Bson::MaxKey,
            ];
            if extra {
                v.insert(7, Bson::String("ab".into()));
            }
            v
        };
        let src: Vec<Document> = keys(false).into_iter().map(|k| doc! {"_id": k, "v": 1}).collect();
        let dst: Vec<Document> = keys(true).into_iter().map(|k| doc! {"_id": k, "v": 1}).collect();
        let (s, items) = run(src, dst, &opts("_id", &[])).await.unwrap();
        assert_eq!((s.same, s.only_dst, s.only_src, s.different), (14, 1, 0, 0));
        assert_eq!(items, vec![(DiffKind::OnlyDst, Bson::String("ab".into()))]);
        // Numbers pair across int / long / double.
        let (s, _) = run(vec![doc! {"_id": 3_i32, "v": 1}], vec![doc! {"_id": 3_i64, "v": 1}], &opts("_id", &["_id"])).await.unwrap();
        assert_eq!(s.same, 1);
    }

    #[tokio::test]
    async fn out_of_order_or_duplicate_keys_abort_instead_of_mispairing() {
        let e = run(vec![doc! {"_id": 2}, doc! {"_id": 1}], vec![], &opts("_id", &[])).await.unwrap_err();
        assert!(e.to_string().contains("not sorted"), "{e}");
        let e = run(vec![], vec![doc! {"k": 1, "_id": 1}, doc! {"k": 1, "_id": 2}], &opts("k", &[])).await.unwrap_err();
        assert!(e.to_string().contains("Duplicate"), "{e}");
        // int 1 and double 1.0 are the same key to the server, so a side holding both is a duplicate.
        let e = run(vec![doc! {"k": 1, "_id": 1}, doc! {"k": 1.0, "_id": 2}], vec![], &opts("k", &[])).await.unwrap_err();
        assert!(e.to_string().contains("Duplicate"), "{e}");
        let e = run(vec![doc! {"_id": 1}], vec![doc! {"_id": 2}], &opts("k", &[])).await.unwrap_err();
        assert!(e.to_string().contains("no `k`"), "{e}");
        let e = run(vec![doc! {"k": [1, 2]}], vec![], &opts("k", &[])).await.unwrap_err();
        assert!(e.to_string().contains("array"), "{e}");
        let dec: mongodb::bson::Decimal128 = "1.5".parse().unwrap();
        let e = run(vec![doc! {"k": dec}], vec![], &opts("k", &[])).await.unwrap_err();
        assert!(e.to_string().contains("not supported"), "{e}");
    }

    #[tokio::test]
    async fn non_id_key_ignores_id_and_supports_dotted_paths() {
        let src = vec![doc! {"_id": 10, "u": {"email": "a"}, "v": 1}, doc! {"_id": 11, "u": {"email": "b"}, "v": 2}];
        let dst = vec![doc! {"_id": 99, "u": {"email": "a"}, "v": 1}, doc! {"_id": 98, "u": {"email": "b"}, "v": 3}];
        let (s, items) = run(src, dst, &opts("u.email", &[])).await.unwrap();
        assert_eq!((s.same, s.different), (1, 1));
        assert_eq!(items, vec![(DiffKind::Different, Bson::String("b".into()))]);
    }

    #[tokio::test]
    async fn tick_error_cancels_the_merge() {
        let src: Vec<Document> = (0..5000).map(|i| doc! {"_id": i}).collect();
        let r = merge_diff(st(src), st(vec![]), &opts("_id", &[]), |_| {}, |n| if n >= 2000 { Err(AppError::Query("Compare cancelled".into())) } else { Ok(()) }).await;
        assert!(r.unwrap_err().to_string().contains("cancelled"));
    }

    #[test]
    fn numbers_compare_exactly_across_types() {
        use std::cmp::Ordering::*;
        let c = |a: Bson, b: Bson| cmp_key(&a, &b).unwrap();
        assert_eq!(c(Bson::Int64(i64::MAX), Bson::Double(9_223_372_036_854_775_808.0)), Less);
        assert_eq!(c(Bson::Int64(9_007_199_254_740_993), Bson::Double(9_007_199_254_740_992.0)), Greater);
        assert_eq!(c(Bson::Int32(-2), Bson::Double(-1.5)), Less);
        assert_eq!(c(Bson::Double(f64::NAN), Bson::Int32(i32::MIN)), Less);
        assert_eq!(c(Bson::Double(0.0), Bson::Double(-0.0)), Equal);
        assert_eq!(c(Bson::Int32(7), Bson::Int64(7)), Equal);
    }

    #[derive(Default)]
    struct RecordingSink {
        calls: Vec<(&'static str, usize)>,
        inserted: Vec<Document>,
        replaced: Vec<(Bson, Document)>,
        deleted: Vec<Bson>,
    }

    impl SyncSink for RecordingSink {
        async fn insert(&mut self, docs: Vec<Document>) -> Result<BatchOutcome, AppError> {
            self.calls.push(("insert", docs.len()));
            let n = docs.len() as u64;
            self.inserted.extend(docs);
            Ok(BatchOutcome { applied: n, ..Default::default() })
        }
        async fn replace(&mut self, docs: Vec<(Bson, Document)>) -> Result<BatchOutcome, AppError> {
            self.calls.push(("replace", docs.len()));
            let n = docs.len() as u64;
            self.replaced.extend(docs);
            Ok(BatchOutcome { applied: n, ..Default::default() })
        }
        async fn delete(&mut self, ids: Vec<Bson>) -> Result<BatchOutcome, AppError> {
            self.calls.push(("delete", ids.len()));
            let n = ids.len() as u64;
            self.deleted.extend(ids);
            Ok(BatchOutcome { applied: n, ..Default::default() })
        }
    }

    const ALL: SyncFlags = SyncFlags { insert_missing: true, replace_different: true, delete_extra: true };

    fn sample() -> (Vec<Document>, Vec<Document>) {
        (
            vec![doc! {"_id": 1, "a": 1}, doc! {"_id": 2, "a": 2}, doc! {"_id": 3, "a": 3}, doc! {"_id": 5, "a": 5}],
            vec![doc! {"_id": 2, "a": 2}, doc! {"_id": 3, "a": 30}, doc! {"_id": 4, "a": 4}, doc! {"_id": 6, "a": 6}],
        )
    }

    async fn sync(src: Vec<Document>, dst: Vec<Document>, key: &str, flags: SyncFlags, dry_run: bool) -> (SyncReport, RecordingSink) {
        let mut sink = RecordingSink::default();
        let join = MergeJoin::new(st(src), st(dst), key, &[]);
        let r = run_sync(join, flags, key == "_id", dry_run, None, &mut sink, |_, _| true).await.unwrap();
        (r, sink)
    }

    #[tokio::test]
    async fn dry_run_writes_nothing() {
        let (src, dst) = sample();
        let (r, sink) = sync(src.clone(), dst.clone(), "_id", ALL, true).await;
        assert!(sink.calls.is_empty(), "{:?}", sink.calls);
        assert!(r.dry_run);
        assert_eq!(r.planned, SyncCounts { insert: 2, replace: 1, delete: 2 });
        assert_eq!(r.applied, SyncCounts::default());
        assert_eq!(r.summary, DiffSummary { only_src: 2, only_dst: 2, different: 1, same: 1, truncated: false });
        // The same plan for real writes exactly what the dry run announced.
        let (r, sink) = sync(src, dst, "_id", ALL, false).await;
        assert!(!r.dry_run);
        assert_eq!(r.applied, SyncCounts { insert: 2, replace: 1, delete: 2 });
        assert_eq!(sink.inserted, vec![doc! {"_id": 1, "a": 1}, doc! {"_id": 5, "a": 5}]);
        assert_eq!(sink.replaced, vec![(Bson::Int32(3), doc! {"_id": 3, "a": 3})]);
        assert_eq!(sink.deleted, vec![Bson::Int32(4), Bson::Int32(6)]);
    }

    #[tokio::test]
    async fn disabled_operations_are_neither_planned_nor_written() {
        let (src, dst) = sample();
        let only_insert = SyncFlags { insert_missing: true, ..Default::default() };
        let (r, sink) = sync(src, dst, "_id", only_insert, false).await;
        assert_eq!(r.planned, SyncCounts { insert: 2, replace: 0, delete: 0 });
        assert_eq!(sink.calls, vec![("insert", 2)]);
    }

    #[tokio::test]
    async fn writes_go_in_batches_of_1000() {
        let src: Vec<Document> = (0..2500).map(|i| doc! {"_id": i}).collect();
        let (r, sink) = sync(src, vec![], "_id", ALL, false).await;
        assert_eq!(sink.calls, vec![("insert", 1000), ("insert", 1000), ("insert", 500)]);
        assert_eq!(r.applied.insert, 2500);
    }

    #[tokio::test]
    async fn non_id_key_replaces_by_destination_id_without_touching_it() {
        let src = vec![doc! {"_id": 10, "k": "a", "v": 1}];
        let dst = vec![doc! {"_id": 99, "k": "a", "v": 2}];
        let (r, sink) = sync(src, dst, "k", ALL, false).await;
        assert_eq!(r.applied.replace, 1);
        assert_eq!(sink.replaced, vec![(Bson::Int32(99), doc! {"k": "a", "v": 1})]);
    }

    #[tokio::test]
    async fn cancel_stops_before_the_next_batch() {
        let src: Vec<Document> = (0..2500).map(|i| doc! {"_id": i}).collect();
        let mut sink = RecordingSink::default();
        let join = MergeJoin::new(st(src), st(vec![]), "_id", &[]);
        let r = run_sync(join, ALL, true, false, None, &mut sink, |read, _| read < 1500).await.unwrap();
        assert!(r.cancelled);
        assert_eq!(sink.calls, vec![("insert", 1000)]);
        assert_eq!(r.applied.insert, 1000);
    }

    #[tokio::test]
    async fn write_errors_are_counted_and_join_errors_mention_what_was_written() {
        struct Failing;
        impl SyncSink for Failing {
            async fn insert(&mut self, docs: Vec<Document>) -> Result<BatchOutcome, AppError> {
                Ok(BatchOutcome { applied: docs.len() as u64 - 1, failed: 1, errors: vec!["E11000".into()] })
            }
            async fn replace(&mut self, _: Vec<(Bson, Document)>) -> Result<BatchOutcome, AppError> { Ok(BatchOutcome::default()) }
            async fn delete(&mut self, _: Vec<Bson>) -> Result<BatchOutcome, AppError> { Ok(BatchOutcome::default()) }
        }
        let src: Vec<Document> = (0..3).map(|i| doc! {"_id": i}).collect();
        let r = run_sync(MergeJoin::new(st(src), st(vec![]), "_id", &[]), ALL, true, false, None, &mut Failing, |_, _| true).await.unwrap();
        assert_eq!((r.applied.insert, r.failed, r.errors.clone()), (2, 1, vec!["E11000".to_string()]));

        let src: Vec<Document> = (0..1001).map(|i| doc! {"_id": i}).chain([doc! {"_id": 0}]).collect();
        let e = run_sync(MergeJoin::new(st(src), st(vec![]), "_id", &[]), ALL, true, false, None, &mut RecordingSink::default(), |_, _| true)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("1000 inserted"), "{e}");
        assert!(e.to_string().contains("Already written"), "{e}");
    }

    async fn sync_limited(src: Vec<Document>, dst: Vec<Document>, limits: SyncCounts) -> (Result<SyncReport, AppError>, RecordingSink) {
        let mut sink = RecordingSink::default();
        let r = run_sync(MergeJoin::new(st(src), st(dst), "_id", &[]), ALL, true, false, Some(limits), &mut sink, |_, _| true).await;
        (r, sink)
    }

    #[tokio::test]
    async fn deletes_are_capped_when_the_source_shrank_after_the_dry_run() {
        let all: Vec<Document> = (0..10).map(|i| doc! {"_id": i}).collect();
        let mut src = all.clone();
        src.truncate(8);
        let (dry, _) = sync(src, all.clone(), "_id", ALL, true).await;
        assert_eq!(dry.planned, SyncCounts { insert: 0, replace: 0, delete: 2 });
        // The source lost three more documents before the real run.
        let shrunk: Vec<Document> = all[..5].to_vec();
        let (r, sink) = sync_limited(shrunk, all, dry.planned).await;
        let e = r.unwrap_err().to_string();
        assert!(e.contains("changed since the dry run") && e.contains("3 more deletes") && e.contains("run the dry run again"), "{e}");
        assert!(sink.deleted.is_empty(), "nothing deleted past the ceiling: {:?}", sink.deleted);
    }

    #[tokio::test]
    async fn unchanged_dataset_syncs_fully_within_the_dry_run_ceilings() {
        let (src, dst) = sample();
        let (dry, _) = sync(src.clone(), dst.clone(), "_id", ALL, true).await;
        let (r, sink) = sync_limited(src, dst, dry.planned.clone()).await;
        let r = r.unwrap();
        assert_eq!(r.applied, dry.planned);
        assert_eq!((r.skipped, r.failed), (0, 0));
        assert_eq!(sink.calls.len(), 3);
    }

    #[tokio::test]
    async fn ceiling_error_carries_the_written_counts() {
        let src: Vec<Document> = (0..2500).map(|i| doc! {"_id": i}).collect();
        let (r, sink) = sync_limited(src, vec![], SyncCounts { insert: 1500, replace: 0, delete: 0 }).await;
        let e = r.unwrap_err().to_string();
        assert!(e.contains("1000 more inserts") && e.contains("Already written: 1000 inserted, 0 replaced, 0 deleted"), "{e}");
        assert_eq!(sink.calls, vec![("insert", 1000)]);
    }

    #[tokio::test]
    async fn writes_that_neither_apply_nor_fail_are_reported_as_skipped() {
        struct Vanished;
        impl SyncSink for Vanished {
            async fn insert(&mut self, docs: Vec<Document>) -> Result<BatchOutcome, AppError> {
                Ok(BatchOutcome { applied: docs.len() as u64, ..Default::default() })
            }
            // One of the two targets was deleted by someone else meanwhile: matched 1.
            async fn replace(&mut self, _: Vec<(Bson, Document)>) -> Result<BatchOutcome, AppError> {
                Ok(BatchOutcome { applied: 1, ..Default::default() })
            }
            async fn delete(&mut self, _: Vec<Bson>) -> Result<BatchOutcome, AppError> { Ok(BatchOutcome::default()) }
        }
        let src = vec![doc! {"_id": 1, "a": 1}, doc! {"_id": 2, "a": 1}];
        let dst = vec![doc! {"_id": 1, "a": 2}, doc! {"_id": 2, "a": 2}];
        let r = run_sync(MergeJoin::new(st(src), st(dst), "_id", &[]), ALL, true, false, None, &mut Vanished, |_, _| true).await.unwrap();
        assert_eq!((r.applied.replace, r.failed, r.skipped), (1, 0, 1));
    }

    #[tokio::test]
    async fn id_type_change_is_skipped_not_replaced() {
        let src = vec![doc! {"_id": 1_i32, "a": 1}, doc! {"_id": 2, "a": 1}];
        let dst = vec![doc! {"_id": 1_i64, "a": 1}, doc! {"_id": 2, "a": 2}];
        let (dry, _) = sync(src.clone(), dst.clone(), "_id", ALL, true).await;
        assert_eq!((dry.planned.replace, dry.type_conflicts), (1, 1));
        assert!(dry.errors[0].contains("type change — cannot replace in place"), "{:?}", dry.errors);
        let (r, sink) = sync(src, dst, "_id", ALL, false).await;
        assert_eq!(sink.replaced, vec![(Bson::Int32(2), doc! {"_id": 2, "a": 1})]);
        assert_eq!((r.applied.replace, r.type_conflicts, r.failed, r.skipped), (1, 1, 0, 0));
    }
}
