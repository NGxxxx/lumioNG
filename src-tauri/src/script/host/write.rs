//! `__write` binding: parses the batched write-op payload from `prelude.js` and applies each op via the driver, gated by [`crate::error::ensure_writable`].
use super::{run_blocking, HostCtx};
use crate::error::ensure_writable;
use mongodb::bson::{Bson, Document};
use rquickjs::{Ctx, Function, Result as JsResult};

// ── Write helpers ─────────────────────────────────────────────────────────────

/// One parsed write op (BSON already materialized).
pub(crate) enum WriteOp {
    InsertOne(Document),
    InsertMany(Vec<Document>),
    UpdateOne { filter: Document, update: Document, upsert: bool, array_filters: Option<Vec<Document>> },
    UpdateMany { filter: Document, update: Document, upsert: bool, array_filters: Option<Vec<Document>> },
    ReplaceOne { filter: Document, replacement: Document, upsert: bool },
    DeleteOne(Document),
    DeleteMany(Document),
}

/// Accumulated write counts + ids across an op array.
#[derive(Default)]
pub(crate) struct WriteAccum {
    pub inserted_count: u64,
    pub matched_count: u64,
    pub modified_count: u64,
    pub upserted_count: u64,
    pub deleted_count: u64,
    pub inserted_ids: Vec<String>, // each is Canonical ExtJSON
    pub upserted_ids: Vec<String>,
}

impl WriteAccum {
    pub fn build_ack(&self) -> String {
        let ids = self.inserted_ids.join(",");
        let ups = self.upserted_ids.join(",");
        format!(
            r#"{{"acknowledged":true,"insertedCount":{{"$numberLong":"{}"}},"matchedCount":{{"$numberLong":"{}"}},"modifiedCount":{{"$numberLong":"{}"}},"upsertedCount":{{"$numberLong":"{}"}},"deletedCount":{{"$numberLong":"{}"}},"insertedIds":[{ids}],"upsertedIds":[{ups}]}}"#,
            self.inserted_count, self.matched_count, self.modified_count,
            self.upserted_count, self.deleted_count
        )
    }
}

fn opt_bool(d: &Document, k: &str) -> bool {
    matches!(d.get(k), Some(Bson::Boolean(true)))
}

fn req_doc(d: &Document, k: &str) -> Result<Document, crate::error::AppError> {
    d.get_document(k).cloned()
        .map_err(|_| crate::error::AppError::Query(format!("write op missing '{k}' document")))
}

fn opt_array_filters(d: &Document) -> Option<Vec<Document>> {
    d.get_array("arrayFilters").ok().map(|arr| {
        arr.iter().filter_map(|b| b.as_document().cloned()).collect()
    })
}

/// Parse the `__write` payload JSON into (ordered, ops).
pub(crate) fn parse_write_ops(ops_json: &str) -> Result<(bool, Vec<WriteOp>), crate::error::AppError> {
    let root = crate::json_bson::canonical_string_to_doc(ops_json)?;
    let ordered = match root.get("ordered") {
        Some(Bson::Boolean(b)) => *b,
        _ => true,
    };
    let arr = root
        .get_array("ops")
        .map_err(|_| crate::error::AppError::Query("write payload missing 'ops' array".into()))?;
    let mut ops = Vec::with_capacity(arr.len());
    for b in arr {
        let d = b
            .as_document()
            .ok_or_else(|| crate::error::AppError::Query("each write op must be a document".into()))?;
        let kind = d
            .get_str("op")
            .map_err(|_| crate::error::AppError::Query("write op missing 'op'".into()))?;
        let op = match kind {
            "insertOne" => WriteOp::InsertOne(req_doc(d, "document")?),
            "insertMany" => {
                let arr = d.get_array("documents").map_err(|_| {
                    crate::error::AppError::Query("insertMany 'documents' must be an array".into())
                })?;
                let docs: Result<Vec<Document>, crate::error::AppError> = arr
                    .iter()
                    .map(|b| {
                        b.as_document()
                            .cloned()
                            .ok_or_else(|| crate::error::AppError::Query(
                                "each insertMany document must be a document".into(),
                            ))
                    })
                    .collect();
                WriteOp::InsertMany(docs?)
            }
            "updateOne" => WriteOp::UpdateOne {
                filter: req_doc(d, "filter")?,
                update: req_doc(d, "update")?,
                upsert: opt_bool(d, "upsert"),
                array_filters: opt_array_filters(d),
            },
            "updateMany" => WriteOp::UpdateMany {
                filter: req_doc(d, "filter")?,
                update: req_doc(d, "update")?,
                upsert: opt_bool(d, "upsert"),
                array_filters: opt_array_filters(d),
            },
            "replaceOne" => WriteOp::ReplaceOne {
                filter: req_doc(d, "filter")?,
                replacement: req_doc(d, "replacement")?,
                upsert: opt_bool(d, "upsert"),
            },
            "deleteOne" => WriteOp::DeleteOne(req_doc(d, "filter")?),
            "deleteMany" => WriteOp::DeleteMany(req_doc(d, "filter")?),
            other => {
                return Err(crate::error::AppError::Query(format!("unknown write op '{other}'")))
            }
        };
        ops.push(op);
    }
    Ok((ordered, ops))
}

// ── __write ──────────────────────────────────────────────────────────────────

pub(super) fn bind_write(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String, coll: String, ops_json: String| -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::bson_json::bson_to_canonical_string;
                use mongodb::options::{ReplaceOptions, UpdateOptions};

                ensure_writable(h.read_only)?;
                let (ordered, ops) = parse_write_ops(&ops_json)?;
                let c = h.client.database(&db).collection::<Document>(&coll);

                let mut acc = WriteAccum::default();
                let mut first_err: Option<crate::error::AppError> = None;

                for op in ops {
                    let step: Result<(), crate::error::AppError> = async {
                        match op {
                            WriteOp::InsertOne(doc) => {
                                let r = c.insert_one(doc).await?;
                                acc.inserted_count += 1;
                                acc.inserted_ids.push(bson_to_canonical_string(&r.inserted_id)?);
                            }
                            WriteOp::InsertMany(docs) => {
                                let r = c.insert_many(docs).await?;
                                acc.inserted_count += r.inserted_ids.len() as u64;
                                let mut entries: Vec<_> = r.inserted_ids.iter().collect();
                                entries.sort_by_key(|(k, _)| **k);
                                for (_, b) in entries {
                                    acc.inserted_ids.push(bson_to_canonical_string(b)?);
                                }
                            }
                            WriteOp::UpdateOne { filter, update, upsert, array_filters } => {
                                let mut o = UpdateOptions::builder().upsert(upsert).build();
                                o.array_filters = array_filters;
                                let r = c.update_one(filter, update).with_options(o).await?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::UpdateMany { filter, update, upsert, array_filters } => {
                                let mut o = UpdateOptions::builder().upsert(upsert).build();
                                o.array_filters = array_filters;
                                let r = c.update_many(filter, update).with_options(o).await?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::ReplaceOne { filter, replacement, upsert } => {
                                let o = ReplaceOptions::builder().upsert(upsert).build();
                                let r = c.replace_one(filter, replacement).with_options(o).await?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::DeleteOne(filter) => {
                                let r = c.delete_one(filter).await?;
                                acc.deleted_count += r.deleted_count;
                            }
                            WriteOp::DeleteMany(filter) => {
                                let r = c.delete_many(filter).await?;
                                acc.deleted_count += r.deleted_count;
                            }
                        }
                        Ok(())
                    }
                    .await;

                    if let Err(e) = step {
                        if ordered {
                            return Err(e);
                        }
                        // NOTE: on a mid-op driver failure, counts/ids for the partially-applied op are lost to the error path — acceptable for v1.
                        first_err.get_or_insert(e);
                    }
                }

                if let Some(e) = first_err {
                    return Err(e);
                }
                Ok::<String, crate::error::AppError>(acc.build_ack())
            })
        },
    )?;
    ctx.globals().set("__write", f)?;
    Ok(())
}

#[cfg(test)]
mod prelude_write_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("../prelude.js");

    const STUBS: &str = r#"
globalThis.__lastWriteOps = null;
globalThis.__write = function(db, coll, ops){ __lastWriteOps = ops; return JSON.stringify({acknowledged:true,insertedCount:{$numberLong:"1"},matchedCount:{$numberLong:"0"},modifiedCount:{$numberLong:"0"},upsertedCount:{$numberLong:"0"},deletedCount:{$numberLong:"0"},insertedIds:[],upsertedIds:[]}); };
globalThis.__lastCmd = null;
globalThis.__runCommand = function(db, cmd){ __lastCmd = cmd; return JSON.stringify({ok:1, value:null}); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
globalThis.__find = function(){ throw new Error("no read in write test"); };
globalThis.__aggregate = function(){ throw new Error("no read in write test"); };
globalThis.__count = function(){ throw new Error("no read in write test"); };
globalThis.__distinct = function(){ throw new Error("no read in write test"); };
globalThis.__listCollections = function(){ throw new Error("no read in write test"); };
globalThis.__cursorFetch = function(){ throw new Error("no read in write test"); };
globalThis.__cursorClose = function(){};
"#;

    fn eval_capture_write(user_js: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let ops: rquickjs::String = ctx.eval("__lastWriteOps || \"\"").unwrap();
            ops.to_string().unwrap()
        })
    }

    fn eval_capture_run_command(user_js: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let cmd: rquickjs::String = ctx.eval("__lastCmd || \"\"").unwrap();
            cmd.to_string().unwrap()
        })
    }

    #[test]
    fn write_op_payloads_carry_op_kind_and_flags() {
        // insertOne: single op, default-ordered, payload preserves the document.
        let ins = eval_capture_write(r#"db.c.insertOne({a:1})"#);
        assert!(ins.contains(r#""op":"insertOne""#));
        assert!(ins.contains(r#""ordered":true"#) || !ins.contains("ordered"));
        assert!(ins.contains(r#""a":1"#));
        // updateOne threads the upsert flag through.
        let upd = eval_capture_write(r#"db.c.updateOne({a:1},{$set:{b:2}},{upsert:true})"#);
        assert!(upd.contains(r#""op":"updateOne""#));
        assert!(upd.contains(r#""upsert":true"#));
    }

    #[test]
    fn bulk_builder_preserves_order_and_ordered_flag() {
        // ordered bulk: ops appear in insertion order, ordered:true.
        let ordered = eval_capture_write(
            r#"var b=db.c.initializeOrderedBulkOp();b.insert({a:1});b.find({a:1}).updateOne({$set:{a:2}});b.find({a:2}).remove();b.execute()"#,
        );
        assert!(ordered.contains(r#""ordered":true"#));
        let i_ins = ordered.find("insertOne").unwrap();
        let i_upd = ordered.find("updateOne").unwrap();
        let i_del = ordered.find("deleteMany").unwrap();
        assert!(i_ins < i_upd && i_upd < i_del);
        // unordered bulk flips the flag.
        let unordered = eval_capture_write(
            r#"var b=db.c.initializeUnorderedBulkOp();b.insert({a:1});b.execute()"#,
        );
        assert!(unordered.contains(r#""ordered":false"#));
    }

    /// DDL / index / findAndModify prelude helpers each build the documented command document.
    /// Table-driven: one row per helper, asserting the substrings that must appear in the command.
    #[test]
    fn prelude_helpers_build_expected_command_shapes() {
        let cases: &[(&str, &[&str])] = &[
            (
                r#"db.c.createIndex({a:1},{name:"a_1",unique:true})"#,
                &[r#""createIndexes":"c""#, r#""name":"a_1""#, r#""unique":true"#],
            ),
            (r#"db.c.dropIndex("a_1")"#, &[r#""dropIndexes":"c""#, r#""index":"a_1""#]),
            (r#"db.c.getIndexes()"#, &[r#""listIndexes":"c""#]),
            (r#"db.c.hideIndex("a_1")"#, &[r#""collMod":"c""#, r#""hidden":true"#]),
            (r#"db.c.reIndex()"#, &[r#""reIndex":"c""#]),
            (r#"db.c.drop()"#, &[r#""drop":"c""#]),
            (
                r#"db.c.renameCollection("c2", true)"#,
                &[r#""renameCollection":"testdb.c""#, r#""to":"testdb.c2""#, r#""dropTarget":true"#],
            ),
        ];
        for (script, expected) in cases {
            let cmd = eval_capture_run_command(script);
            for needle in *expected {
                assert!(cmd.contains(needle), "`{script}` command missing `{needle}`, got: {cmd}");
            }
        }
        // findOneAndDelete uses the find-and-modify command (casing tolerant) with remove:true.
        let fam = eval_capture_run_command(r#"db.c.findOneAndDelete({a:1})"#);
        assert!(fam.contains(r#""findAndModify""#) || fam.contains(r#""findandmodify""#));
        assert!(fam.contains(r#""remove":true"#));
        // createIndex key may serialize as either plain or ExtJSON int.
        let ci = eval_capture_run_command(r#"db.c.createIndex({a:1})"#);
        assert!(ci.contains(r#""key":{"a":1}"#) || ci.contains(r#""key":{"a":{"$numberInt":"1"}}"#));
    }
}

#[cfg(test)]
mod write_ops_tests {
    use super::*;

    #[test]
    fn ensure_writable_blocks_when_read_only() {
        assert!(ensure_writable(true).is_err());
        assert!(ensure_writable(false).is_ok());
    }

    #[test]
    fn parse_ordered_flag_and_op_kind() {
        // Default ordered:true, op materialized to the right WriteOp variant.
        let (ordered, ops) =
            parse_write_ops(r#"{"ops":[{"op":"deleteOne","filter":{"a":1}}]}"#).unwrap();
        assert!(ordered);
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], WriteOp::DeleteOne(_)));
        // Explicit ordered:false honored.
        let (ordered, _) =
            parse_write_ops(r#"{"ordered":false,"ops":[{"op":"insertOne","document":{}}]}"#)
                .unwrap();
        assert!(!ordered);
    }

    #[test]
    fn parse_rejects_malformed_payloads() {
        assert!(parse_write_ops(r#"{"ops":[{"op":"frobnicate"}]}"#).is_err()); // unknown op
        assert!(parse_write_ops(r#"{"ops":{}}"#).is_err()); // ops not an array
        // insertMany element that is not a document
        assert!(parse_write_ops(r#"{"ops":[{"op":"insertMany","documents":[{"a":1},2]}]}"#).is_err());
    }

    #[test]
    fn build_ack_serializes_counts_and_both_id_arrays() {
        let mut a = WriteAccum {
            inserted_count: 2,
            matched_count: 1,
            modified_count: 1,
            deleted_count: 3,
            upserted_count: 1,
            ..Default::default()
        };
        a.inserted_ids.push(r#"{"$oid":"507f1f77bcf86cd799439011"}"#.into());
        a.upserted_ids.push(r#"{"$oid":"aabbccddeeff001122334455"}"#.into());
        let json = a.build_ack();
        assert!(json.contains(r#""insertedCount":{"$numberLong":"2"}"#));
        assert!(json.contains(r#""deletedCount":{"$numberLong":"3"}"#));
        assert!(json.contains(r#""upsertedCount":{"$numberLong":"1"}"#));
        assert!(json.contains(r#""$oid":"507f1f77bcf86cd799439011""#));
        assert!(json.contains(r#""$oid":"aabbccddeeff001122334455""#));
        assert!(json.contains(r#""upsertedIds""#));
    }
}
