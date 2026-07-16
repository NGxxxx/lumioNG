// prelude.js — mongosh read shim for QuickJS
// Injected globals from Rust host:
//   __find, __aggregate, __count, __distinct, __runCommand, __adminCommand, __listCollections
//   __cursorFetch, __cursorClose, __print
//   __DBNAME  (current database name string)
//
// All host fns accept/return Canonical Extended JSON strings.
// __find / __aggregate return: {"handle":<u32>,"rows":[<doc>,...],"exhausted":<bool>,"bytes":<u32>}
// __cursorFetch returns:       {"rows":[<doc>,...],"exhausted":<bool>,"bytes":<u32>}
// __count returns:             {"$numberLong":"<n>"}
// __distinct returns:          [<value>, ...]
//
// "bytes" is the size in bytes of the batch's row JSON, reported by the host so Cursor.toArray()
// can stop pulling more once the accumulated result gets too large — a handful of huge documents
// (e.g. 10 docs x 16MB) would otherwise exhaust the QuickJS heap long before __CAP (a row count)
// ever kicks in.

"use strict";

// Total accumulated row-JSON bytes toArray() will pull before stopping (0 = unlimited). Not
// user-configurable — like the engine's 256MB heap limit, it's an internal safety valve.
var __BYTE_CAP = 48 * 1024 * 1024;

// ── BSON constructors ─────────────────────────────────────────────────────────
// Each returns a plain object with toJSON() that emits Canonical Extended JSON,
// so JSON.stringify(filter) on user-supplied values produces valid ExtJSON for the host.

function ObjectId(hex) {
  if (hex === undefined) {
    // Generate a random 24-hex string as a placeholder (not real OID generation)
    hex = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
  return {
    $oid: hex,
    toJSON() { return { $oid: hex }; },
    toString() { return 'ObjectId("' + hex + '")'; },
    equals(other) { return other && other.$oid === hex; },
  };
}

function NumberInt(v) {
  const n = String(Math.trunc(Number(v)));
  return {
    toJSON() { return { $numberInt: n }; },
    valueOf() { return parseInt(n, 10); },
    toString() { return "NumberInt(" + n + ")"; },
  };
}

function NumberLong(v) {
  const n = typeof v === "bigint" ? v.toString() : String(v);
  return {
    toJSON() { return { $numberLong: n }; },
    valueOf() { return Number(n); },
    toString() { return "NumberLong(" + n + ")"; },
  };
}

function NumberDecimal(v) {
  const s = String(v);
  return {
    toJSON() { return { $numberDecimal: s }; },
    toString() { return "NumberDecimal(" + s + ")"; },
  };
}

// ISODate: canonical form { "$date": { "$numberLong": "<epoch_ms>" } }
// mongodb driver's Bson::try_from accepts both canonical and relaxed, but canonical is safest.
function ISODate(s) {
  const d = s ? new Date(s) : new Date();
  return {
    toJSON() { return { $date: { $numberLong: String(d.getTime()) } }; },
    toString() { return d.toISOString(); },
    getTime() { return d.getTime(); },
    toISOString() { return d.toISOString(); },
  };
}

// Pure-JS base64 encoder (btoa is not available in QuickJS / rquickjs).
function _base64(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "", i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b = (bytes[i] << 16) | (bytes[i+1] << 8) | bytes[i+2];
    out += chars[(b >> 18) & 63] + chars[(b >> 12) & 63] + chars[(b >> 6) & 63] + chars[b & 63];
  }
  if (i + 1 === bytes.length) { const b = bytes[i] << 16; out += chars[(b >> 18) & 63] + chars[(b >> 12) & 63] + "=="; }
  else if (i + 2 === bytes.length) { const b = (bytes[i] << 16) | (bytes[i+1] << 8); out += chars[(b >> 18) & 63] + chars[(b >> 12) & 63] + chars[(b >> 6) & 63] + "="; }
  return out;
}

// Coerce an ExtJSON numeric wrapper ($numberLong/$numberInt/$numberDouble) or raw value
// into a JS number (for size/count helpers that read command replies).
function _num(v) {
  if (v && typeof v === "object") {
    if (v.$numberLong !== undefined) return Number(v.$numberLong);
    if (v.$numberInt !== undefined) return Number(v.$numberInt);
    if (v.$numberDouble !== undefined) return Number(v.$numberDouble);
    if (v.$numberDecimal !== undefined) return Number(v.$numberDecimal);
  }
  return Number(v);
}

// UUID: stored as $binary with subtype "04" (UUID subtype)
function UUID(hex) {
  // Accept hex string with or without dashes; normalize to no-dashes lowercase
  const clean = (hex || "").replace(/-/g, "").toLowerCase();
  // Convert hex to base64
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  const b64 = _base64(bytes);
  return {
    toJSON() { return { $binary: { base64: b64, subType: "04" } }; },
    toString() { return "UUID(" + hex + ")"; },
  };
}

// BinData(subtype, base64str)
function BinData(subtype, base64) {
  const subTypeHex = subtype.toString(16).padStart(2, "0");
  return {
    toJSON() { return { $binary: { base64: base64, subType: subTypeHex } }; },
    toString() { return "BinData(" + subtype + ", " + base64 + ")"; },
  };
}

// Timestamp: { "$timestamp": { "t": <seconds>, "i": <increment> } }
function Timestamp(t, i) {
  t = t || 0;
  i = i || 0;
  return {
    toJSON() { return { $timestamp: { t: t, i: i } }; },
    toString() { return "Timestamp(" + t + ", " + i + ")"; },
  };
}

function MinKey() {
  return {
    toJSON() { return { $minKey: 1 }; },
    toString() { return "MinKey()"; },
  };
}
function MaxKey() {
  return {
    toJSON() { return { $maxKey: 1 }; },
    toString() { return "MaxKey()"; },
  };
}

// ── Write helpers ─────────────────────────────────────────────────────────────

// Wrap a __write ack (ExtJSON string) into a mongosh-style result object.
function WriteResult(ackJson) {
  var a = JSON.parse(ackJson);
  return {
    acknowledged: true,
    insertedId: (a.insertedIds && a.insertedIds[0]) || null,
    insertedCount: Number((a.insertedCount && a.insertedCount.$numberLong) || 0),
    matchedCount: Number((a.matchedCount && a.matchedCount.$numberLong) || 0),
    modifiedCount: Number((a.modifiedCount && a.modifiedCount.$numberLong) || 0),
    upsertedCount: Number((a.upsertedCount && a.upsertedCount.$numberLong) || 0),
    upsertedId: (a.upsertedIds && a.upsertedIds[0]) || null,
    deletedCount: Number((a.deletedCount && a.deletedCount.$numberLong) || 0),
    toJSON() { return a; },
  };
}
function BulkWriteResult(ackJson) { return WriteResult(ackJson); }

// Send one op array to the host and wrap the ack.
function _runWrite(dbn, c, ordered, ops) {
  var ack = __write(dbn, c, JSON.stringify({ ordered: ordered, ops: ops }));
  return WriteResult(ack);
}

// ── Console / print ───────────────────────────────────────────────────────────

function print() {
  var args = Array.prototype.slice.call(arguments);
  __print("log", args.map(function (x) { return typeof x === "string" ? x : JSON.stringify(x); }).join(" "));
}

function printjson(x) {
  __print("log", JSON.stringify(x, null, 2));
}

var console = {
  log: print,
  warn: print,
  error: function () {
    var args = Array.prototype.slice.call(arguments);
    __print("error", args.map(String).join(" "));
  },
  info: print,
};

// ── Cursor ────────────────────────────────────────────────────────────────────
// Lazy cursor: does not open the host cursor until materialized.
// kind: "find" | "agg"

// Every Cursor constructed during this run, in construction order — used by __finalize() to
// derive explainHint independently of how the completion value ends up shaped (see below).
var __cursorsConstructed = [];

class Cursor {
  constructor(db, coll, kind, query, opts) {
    __cursorsConstructed.push(this);
    this._db = db;
    this._coll = coll;
    this._kind = kind;
    this._q = query;      // filter doc (find) or pipeline array (agg)
    this._o = opts || {}; // find options: sort, limit, skip, projection, hint, maxTimeMS
    this._pure = true;    // false if .map() was called — disables inline-edit in the grid
    // true if projection excludes _id — also disables inline-edit. Covers both the two-arg
    // `find(q, {_id:0})` form (projection arrives via opts here) and the chained
    // `.find(q).projection({_id:0})` form (set again by the projection() method below).
    this._noId = !!(this._o.projection && this._o.projection._id === 0);
    // look-ahead buffer for hasNext/next
    this._buf = null;     // null = not opened yet; array when open
    this._bufBytes = 0;   // byte size of the batch buffered into _buf
    this._handle = null;
    this._exhausted = false;
    this._capped = false; // true once toArray() stopped before natural exhaustion (row or byte cap)
  }

  sort(s)       { this._o.sort = s; return this; }
  limit(n)      { this._o.limit = n; return this; }
  skip(n)       { this._o.skip = n; return this; }
  hint(h)       { this._o.hint = h; return this; }
  maxTimeMS(ms) { this._o.maxTimeMS = ms; return this; }

  projection(p) {
    this._o.projection = p;
    if (p && p._id === 0) this._noId = true;
    return this;
  }

  // .map() materializes immediately and returns a plain array (sets _pure = false).
  map(fn) {
    this._pure = false;
    return this.toArray().map(fn);
  }

  // Open the host cursor and return the first batch response object.
  _open() {
    const fn = this._kind === "agg" ? __aggregate : __find;
    const qJson = JSON.stringify(this._q);
    const oJson = JSON.stringify(this._o);
    return JSON.parse(fn(this._db, this._coll, qJson, oJson));
  }

  // Materialize all rows into an array. Reuses a handle already opened by hasNext()/next()
  // (look-ahead buffer) instead of re-running the query, which would leak the first handle.
  // Stops draining once __CAP rows OR __BYTE_CAP bytes are collected (0 = unlimited), so
  // neither an unbounded collection nor a handful of huge documents can exhaust the QuickJS heap.
  toArray() {
    let handle, out, exhausted, bytes;
    if (this._buf !== null) {
      // Opened lazily by hasNext()/next(): drain the existing handle, don't re-open.
      out = this._buf.slice();
      handle = this._handle;
      exhausted = this._exhausted;
      bytes = this._bufBytes;
      this._buf = [];
    } else {
      const r0 = this._open();
      handle = r0.handle;
      out = r0.rows.slice();
      exhausted = r0.exhausted;
      bytes = r0.bytes || 0;
    }
    const cap = typeof __CAP !== "undefined" ? __CAP : 0;
    const byteCap = typeof __BYTE_CAP !== "undefined" ? __BYTE_CAP : 0;
    while (!exhausted && (cap === 0 || out.length < cap) && (byteCap === 0 || bytes < byteCap)) {
      const b = JSON.parse(__cursorFetch(handle, 1000));
      out.push.apply(out, b.rows);
      bytes += b.bytes || 0;
      exhausted = b.exhausted;
    }
    this._capped = !exhausted;
    if (handle != null) { try { __cursorClose(handle); } catch (_) {} }
    this._handle = null;
    this._exhausted = true;
    return out;
  }

  // Iterate rows without loading all into memory at once.
  forEach(fn) {
    const r0 = this._open();
    const handle = r0.handle;
    for (let i = 0; i < r0.rows.length; i++) fn(r0.rows[i]);
    let exhausted = r0.exhausted;
    while (!exhausted) {
      const b = JSON.parse(__cursorFetch(handle, 1000));
      for (let i = 0; i < b.rows.length; i++) fn(b.rows[i]);
      exhausted = b.exhausted;
    }
    if (handle != null) { try { __cursorClose(handle); } catch (_) {} }
  }

  [Symbol.iterator]() {
    return this.toArray()[Symbol.iterator]();
  }

  // hasNext / next use a small look-ahead buffer (lazy open on first call).
  _ensureOpen() {
    if (this._buf === null) {
      const r = this._open();
      this._handle = r.exhausted ? null : r.handle;
      this._exhausted = r.exhausted;
      this._buf = r.rows.slice();
      this._bufBytes = r.bytes || 0;
    }
  }

  hasNext() {
    this._ensureOpen();
    if (this._buf.length > 0) return true;
    if (this._exhausted) return false;
    // Fetch more
    const r = JSON.parse(__cursorFetch(this._handle, 100));
    this._buf = r.rows.slice();
    this._bufBytes = r.bytes || 0;
    this._exhausted = r.exhausted;
    if (r.exhausted) this._handle = null;
    return this._buf.length > 0;
  }

  next() {
    if (!this.hasNext()) throw new Error("Cursor has no more documents");
    return this._buf.shift();
  }

  count() {
    // convenience: run a count for the same query (find only)
    const n = __count(this._db, this._coll, JSON.stringify(this._q || {}), "count");
    return Number(JSON.parse(n).$numberLong);
  }

  size() { return this.count(); }

  explain(verbosity) {
    var inner = this._kind === "agg"
      ? { aggregate: this._coll, pipeline: this._q, cursor: {} }
      : Object.assign({ find: this._coll, filter: this._q }, this._o);
    var cmd = { explain: inner, verbosity: verbosity || "queryPlanner" };
    return JSON.parse(__runCommand(this._db, JSON.stringify(cmd)));
  }
}

// ── Bulk builder ──────────────────────────────────────────────────────────────

function makeBulk(dbn, c, ordered) {
  var ops = [];
  var pendingFilter = null;
  var api = {
    insert(doc) { ops.push({ op: "insertOne", document: doc }); return api; },
    find(filter) {
      pendingFilter = filter || {};
      return {
        update(u)      { ops.push({ op: "updateMany", filter: pendingFilter, update: u, upsert: false }); return api; },
        updateOne(u)   { ops.push({ op: "updateOne", filter: pendingFilter, update: u, upsert: false }); return api; },
        replaceOne(r)  { ops.push({ op: "replaceOne", filter: pendingFilter, replacement: r, upsert: false }); return api; },
        upsert() {
          return {
            update(u)     { ops.push({ op: "updateMany", filter: pendingFilter, update: u, upsert: true }); return api; },
            updateOne(u)  { ops.push({ op: "updateOne", filter: pendingFilter, update: u, upsert: true }); return api; },
            replaceOne(r) { ops.push({ op: "replaceOne", filter: pendingFilter, replacement: r, upsert: true }); return api; },
          };
        },
        delete()    { ops.push({ op: "deleteMany", filter: pendingFilter }); return api; },
        remove()    { ops.push({ op: "deleteMany", filter: pendingFilter }); return api; },
        deleteOne() { ops.push({ op: "deleteOne", filter: pendingFilter }); return api; },
        removeOne() { ops.push({ op: "deleteOne", filter: pendingFilter }); return api; },
      };
    },
    getOperations() { return ops.slice(); },
    toJSON() { return { ordered: ordered, ops: ops }; },
    execute() { return _runWrite(dbn, c, ordered, ops); },
  };
  return api;
}

// ── Collection ────────────────────────────────────────────────────────────────

function makeColl(dbn, c) {
  return {
    find(q, p) {
      const opts = {};
      if (p) { opts.projection = p; }
      return new Cursor(dbn, c, "find", q || {}, opts);
    },

    findOne(q, p) {
      const opts = { limit: 1 };
      if (p) { opts.projection = p; }
      const rows = new Cursor(dbn, c, "find", q || {}, opts).toArray();
      return rows.length > 0 ? rows[0] : null;
    },

    aggregate(pipeline) {
      return new Cursor(dbn, c, "agg", pipeline || [], {});
    },

    countDocuments(q) {
      const n = __count(dbn, c, JSON.stringify(q || {}), "count");
      return Number(JSON.parse(n).$numberLong);
    },

    estimatedDocumentCount() {
      const n = __count(dbn, c, "{}", "estimated");
      return Number(JSON.parse(n).$numberLong);
    },

    distinct(field, q) {
      return JSON.parse(__distinct(dbn, c, field, JSON.stringify(q || {})));
    },

    // Convenience alias used in some mongosh scripts
    count(q) {
      const mode = q ? "count" : "estimated";
      const n = __count(dbn, c, JSON.stringify(q || {}), mode);
      return Number(JSON.parse(n).$numberLong);
    },

    getName() { return c; },
    getFullName() { return dbn + "." + c; },

    // ── Write methods ──────────────────────────────────────────────────────
    insertOne(doc)   { return _runWrite(dbn, c, true, [{ op: "insertOne", document: doc }]); },
    insertMany(docs, opts) {
      var ordered = !(opts && opts.ordered === false);
      return _runWrite(dbn, c, ordered, [{ op: "insertMany", documents: docs }]);
    },
    insert(docOrDocs) {
      return Array.isArray(docOrDocs)
        ? this.insertMany(docOrDocs)
        : this.insertOne(docOrDocs);
    },
    updateOne(filter, update, opts) {
      opts = opts || {};
      return _runWrite(dbn, c, true, [{
        op: "updateOne", filter: filter || {}, update: update,
        upsert: !!opts.upsert, arrayFilters: opts.arrayFilters,
      }]);
    },
    updateMany(filter, update, opts) {
      opts = opts || {};
      return _runWrite(dbn, c, true, [{
        op: "updateMany", filter: filter || {}, update: update,
        upsert: !!opts.upsert, arrayFilters: opts.arrayFilters,
      }]);
    },
    update(filter, update, opts) {
      opts = opts || {};
      return opts.multi ? this.updateMany(filter, update, opts) : this.updateOne(filter, update, opts);
    },
    replaceOne(filter, replacement, opts) {
      opts = opts || {};
      return _runWrite(dbn, c, true, [{
        op: "replaceOne", filter: filter || {}, replacement: replacement, upsert: !!opts.upsert,
      }]);
    },
    deleteOne(filter) { return _runWrite(dbn, c, true, [{ op: "deleteOne", filter: filter || {} }]); },
    deleteMany(filter) { return _runWrite(dbn, c, true, [{ op: "deleteMany", filter: filter || {} }]); },
    remove(filter, justOne) {
      return justOne ? this.deleteOne(filter) : this.deleteMany(filter);
    },

    bulkWrite(ops, opts) {
      var ordered = !(opts && opts.ordered === false);
      var mapped = ops.map(function (o) {
        if (o.insertOne)  return { op: "insertOne", document: o.insertOne.document };
        if (o.updateOne)  return { op: "updateOne", filter: o.updateOne.filter, update: o.updateOne.update, upsert: !!o.updateOne.upsert, arrayFilters: o.updateOne.arrayFilters };
        if (o.updateMany) return { op: "updateMany", filter: o.updateMany.filter, update: o.updateMany.update, upsert: !!o.updateMany.upsert, arrayFilters: o.updateMany.arrayFilters };
        if (o.replaceOne) return { op: "replaceOne", filter: o.replaceOne.filter, replacement: o.replaceOne.replacement, upsert: !!o.replaceOne.upsert };
        if (o.deleteOne)  return { op: "deleteOne", filter: o.deleteOne.filter };
        if (o.deleteMany) return { op: "deleteMany", filter: o.deleteMany.filter };
        throw new Error("Unknown bulkWrite operation");
      });
      return _runWrite(dbn, c, ordered, mapped);
    },

    initializeOrderedBulkOp()   { return makeBulk(dbn, c, true); },
    initializeUnorderedBulkOp() { return makeBulk(dbn, c, false); },

    // findAndModify family → findAndModify command (gated by read-only on the command channel)
    findOneAndUpdate(filter, update, opts) {
      opts = opts || {};
      var cmd = { findAndModify: c, query: filter || {}, update: update };
      if (opts.upsert) cmd.upsert = true;
      if (opts.returnNewDocument || opts.returnDocument === "after") cmd.new = true;
      if (opts.sort) cmd.sort = opts.sort;
      if (opts.projection) cmd.fields = opts.projection;
      var r = JSON.parse(__runCommand(dbn, JSON.stringify(cmd)));
      return r.value != null ? r.value : null;
    },
    findOneAndReplace(filter, replacement, opts) {
      return this.findOneAndUpdate(filter, replacement, opts);
    },
    findOneAndDelete(filter, opts) {
      opts = opts || {};
      var cmd = { findAndModify: c, query: filter || {}, remove: true };
      if (opts.sort) cmd.sort = opts.sort;
      if (opts.projection) cmd.fields = opts.projection;
      var r = JSON.parse(__runCommand(dbn, JSON.stringify(cmd)));
      return r.value != null ? r.value : null;
    },
    findAndModify(spec) {
      spec = spec || {};
      var cmd = { findAndModify: c, query: spec.query || {} };
      if (spec.update) cmd.update = spec.update;
      if (spec.remove) cmd.remove = true;
      if (spec.upsert) cmd.upsert = true;
      if (spec.new) cmd.new = true;
      if (spec.sort) cmd.sort = spec.sort;
      if (spec.fields) cmd.fields = spec.fields;
      var r = JSON.parse(__runCommand(dbn, JSON.stringify(cmd)));
      return r.value != null ? r.value : null;
    },

    // ── Indexes / DDL (route through runCommand; read-only enforced in Rust) ──
    createIndex(keys, opts) {
      var spec = Object.assign({ key: keys }, opts || {});
      if (!spec.name) {
        spec.name = Object.keys(keys).map(function (k) { return k + "_" + keys[k]; }).join("_");
      }
      return JSON.parse(__runCommand(dbn, JSON.stringify({ createIndexes: c, indexes: [spec] })));
    },
    createIndexes(keysArray, opts) {
      var indexes = (keysArray || []).map(function (keys) {
        var spec = Object.assign({ key: keys }, opts || {});
        if (!spec.name) {
          spec.name = Object.keys(keys).map(function (k) { return k + "_" + keys[k]; }).join("_");
        }
        return spec;
      });
      return JSON.parse(__runCommand(dbn, JSON.stringify({ createIndexes: c, indexes: indexes })));
    },
    dropIndex(index) {
      return JSON.parse(__runCommand(dbn, JSON.stringify({ dropIndexes: c, index: index })));
    },
    dropIndexes(index) {
      return JSON.parse(__runCommand(dbn, JSON.stringify({ dropIndexes: c, index: index || "*" })));
    },
    getIndexes() {
      var r = JSON.parse(__runCommand(dbn, JSON.stringify({ listIndexes: c })));
      return (r.cursor && r.cursor.firstBatch) || [];
    },
    hideIndex(index) {
      var key = typeof index === "string" ? "name" : "keyPattern";
      var mod = { index: {} };
      mod.index[key] = index;
      mod.index.hidden = true;
      return JSON.parse(__runCommand(dbn, JSON.stringify({ collMod: c, index: mod.index })));
    },
    unhideIndex(index) {
      var key = typeof index === "string" ? "name" : "keyPattern";
      var idx = {};
      idx[key] = index;
      idx.hidden = false;
      return JSON.parse(__runCommand(dbn, JSON.stringify({ collMod: c, index: idx })));
    },
    reIndex() {
      return JSON.parse(__runCommand(dbn, JSON.stringify({ reIndex: c })));
    },
    drop() {
      return JSON.parse(__runCommand(dbn, JSON.stringify({ drop: c })));
    },
    renameCollection(target, dropTarget) {
      // renameCollection is an admin command: full namespaces, run against admin db.
      var cmd = { renameCollection: dbn + "." + c, to: dbn + "." + target };
      if (dropTarget) cmd.dropTarget = true;
      return JSON.parse(__runCommand("admin", JSON.stringify(cmd)));
    },

    // ── Collection admin ──────────────────────────────────────────────────
    stats(scale) {
      var cmd = { collStats: c };
      if (scale !== undefined) cmd.scale = scale;
      return JSON.parse(__runCommand(dbn, JSON.stringify(cmd)));
    },
    dataSize()       { return _num(this.stats().size); },
    storageSize()    { return _num(this.stats().storageSize); },
    totalIndexSize() { return _num(this.stats().totalIndexSize); },
    totalSize() {
      var s = this.stats();
      return _num(s.storageSize) + _num(s.totalIndexSize);
    },
    isCapped()       { return !!this.stats().capped; },
    validate(opts) {
      var cmd = { validate: c };
      if (opts && opts.full) cmd.full = true;
      if (opts && opts.repair) cmd.repair = true;
      return JSON.parse(__runCommand(dbn, JSON.stringify(cmd)));
    },
    latencyStats(opts) {
      var stage = { $collStats: { latencyStats: { histograms: !!(opts && opts.histograms) } } };
      return new Cursor(dbn, c, "agg", [stage], {}).toArray();
    },
    explain(verbosity) {
      var v = verbosity || "queryPlanner";
      var dbn_ = dbn, c_ = c;
      return {
        find(q, p) {
          var inner = { find: c_, filter: q || {} };
          if (p) inner.projection = p;
          return JSON.parse(__runCommand(dbn_, JSON.stringify({ explain: inner, verbosity: v })));
        },
        aggregate(pipeline) {
          var inner = { aggregate: c_, pipeline: pipeline || [], cursor: {} };
          return JSON.parse(__runCommand(dbn_, JSON.stringify({ explain: inner, verbosity: v })));
        },
        count(q) {
          var inner = { count: c_, query: q || {} };
          return JSON.parse(__runCommand(dbn_, JSON.stringify({ explain: inner, verbosity: v })));
        },
      };
    },
  };
}

// ── Database ──────────────────────────────────────────────────────────────────

function makeDb(name) {
  const d = {
    getName()         { return name; },
    getSiblingDB(n)   { return makeDb(n); },
    getCollection(c)  { return makeColl(name, c); },
    getCollectionNames() { return JSON.parse(__listCollections(name)); },
    runCommand(cmd)   { return JSON.parse(__runCommand(name, JSON.stringify(cmd))); },
    adminCommand(cmd) { return JSON.parse(__adminCommand(JSON.stringify(cmd))); },

    // ── Database diagnostics ──────────────────────────────────────────────
    stats(scale) {
      var cmd = { dbStats: 1 };
      if (scale !== undefined) cmd.scale = scale;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    serverStatus(opts) {
      return JSON.parse(__adminCommand(JSON.stringify(Object.assign({ serverStatus: 1 }, opts || {}))));
    },
    hostInfo()         { return JSON.parse(__adminCommand(JSON.stringify({ hostInfo: 1 }))); },
    currentOp(arg) {
      var cmd = { currentOp: 1 };
      if (arg && typeof arg === "object") Object.assign(cmd, arg);
      else if (arg === true) cmd.$all = true;
      return JSON.parse(__adminCommand(JSON.stringify(cmd)));
    },
    killOp(opid)       { return JSON.parse(__adminCommand(JSON.stringify({ killOp: 1, op: opid }))); },
    serverBuildInfo()  { return JSON.parse(__adminCommand(JSON.stringify({ buildInfo: 1 }))); },
    serverCmdLineOpts(){ return JSON.parse(__adminCommand(JSON.stringify({ getCmdLineOpts: 1 }))); },
    version()          { return this.serverBuildInfo().version; },
    hello()            { return JSON.parse(__runCommand(name, JSON.stringify({ hello: 1 }))); },
    commandHelp(cmdName) {
      var cmd = {}; cmd[cmdName] = 1; cmd.help = true;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    listCommands()     { return JSON.parse(__runCommand(name, JSON.stringify({ listCommands: 1 }))); },
    getProfilingStatus() { return JSON.parse(__runCommand(name, JSON.stringify({ profile: -1 }))); },
    setProfilingLevel(level, opts) {
      var cmd = { profile: level };
      if (opts && opts.slowms !== undefined) cmd.slowms = opts.slowms;
      if (opts && opts.sampleRate !== undefined) cmd.sampleRate = opts.sampleRate;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    getLogComponents() {
      var r = JSON.parse(__adminCommand(JSON.stringify({ getParameter: 1, logComponentVerbosity: 1 })));
      return r.logComponentVerbosity;
    },
    setLogLevel(level, component) {
      var verbosity = {};
      if (component) {
        // Dotted path e.g. "storage.journal" → nested {storage:{journal:{verbosity:level}}}
        var parts = component.split(".");
        var node = verbosity;
        for (var i = 0; i < parts.length; i++) {
          node[parts[i]] = (i === parts.length - 1) ? { verbosity: level } : {};
          node = node[parts[i]];
        }
      } else {
        verbosity.verbosity = level;
      }
      return JSON.parse(__adminCommand(JSON.stringify({ setParameter: 1, logComponentVerbosity: verbosity })));
    },
    getLog(logName)    { return JSON.parse(__adminCommand(JSON.stringify({ getLog: logName || "global" }))); },

    // ── DDL & database utilities ──────────────────────────────────────────
    createCollection(collName, opts) {
      return JSON.parse(__runCommand(name, JSON.stringify(Object.assign({ create: collName }, opts || {}))));
    },
    createView(viewName, source, pipeline, opts) {
      var cmd = Object.assign({ create: viewName, viewOn: source, pipeline: pipeline || [] }, opts || {});
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    dropDatabase()     { return JSON.parse(__runCommand(name, JSON.stringify({ dropDatabase: 1 }))); },
    getCollectionInfos(filter) {
      var cmd = { listCollections: 1 };
      if (filter) cmd.filter = filter;
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return (r.cursor && r.cursor.firstBatch) || [];
    },
    aggregate(pipeline, opts) {
      var cmd = Object.assign({ aggregate: 1, pipeline: pipeline || [], cursor: {} }, opts || {});
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return (r.cursor && r.cursor.firstBatch) || [];
    },

    // ── User management (run against the owning db) ───────────────────────
    createUser(userObj, writeConcern) {
      userObj = userObj || {};
      var cmd = { createUser: userObj.user, pwd: userObj.pwd, roles: userObj.roles || [] };
      if (userObj.customData) cmd.customData = userObj.customData;
      if (userObj.mechanisms) cmd.mechanisms = userObj.mechanisms;
      if (userObj.authenticationRestrictions) cmd.authenticationRestrictions = userObj.authenticationRestrictions;
      if (writeConcern) cmd.writeConcern = writeConcern;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    dropUser(username, writeConcern) {
      var cmd = { dropUser: username };
      if (writeConcern) cmd.writeConcern = writeConcern;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    dropAllUsers()     { return JSON.parse(__runCommand(name, JSON.stringify({ dropAllUsersFromDatabase: 1 }))); },
    updateUser(username, update) {
      return JSON.parse(__runCommand(name, JSON.stringify(Object.assign({ updateUser: username }, update || {}))));
    },
    changeUserPassword(username, pwd) {
      return JSON.parse(__runCommand(name, JSON.stringify({ updateUser: username, pwd: pwd })));
    },
    grantRolesToUser(username, roles) {
      return JSON.parse(__runCommand(name, JSON.stringify({ grantRolesToUser: username, roles: roles || [] })));
    },
    revokeRolesFromUser(username, roles) {
      return JSON.parse(__runCommand(name, JSON.stringify({ revokeRolesFromUser: username, roles: roles || [] })));
    },
    getUser(username, args) {
      var cmd = { usersInfo: { user: username, db: name } };
      if (args) Object.assign(cmd, args);
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return (r.users && r.users[0]) || null;
    },
    getUsers(args) {
      var cmd = { usersInfo: 1 };
      if (args) Object.assign(cmd, args);
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return r.users || [];
    },

    // ── Role management ───────────────────────────────────────────────────
    createRole(roleObj, writeConcern) {
      roleObj = roleObj || {};
      var cmd = { createRole: roleObj.role, privileges: roleObj.privileges || [], roles: roleObj.roles || [] };
      if (roleObj.authenticationRestrictions) cmd.authenticationRestrictions = roleObj.authenticationRestrictions;
      if (writeConcern) cmd.writeConcern = writeConcern;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    dropRole(rolename, writeConcern) {
      var cmd = { dropRole: rolename };
      if (writeConcern) cmd.writeConcern = writeConcern;
      return JSON.parse(__runCommand(name, JSON.stringify(cmd)));
    },
    dropAllRoles()     { return JSON.parse(__runCommand(name, JSON.stringify({ dropAllRolesFromDatabase: 1 }))); },
    updateRole(rolename, update) {
      return JSON.parse(__runCommand(name, JSON.stringify(Object.assign({ updateRole: rolename }, update || {}))));
    },
    getRole(rolename, args) {
      var cmd = { rolesInfo: { role: rolename, db: name } };
      if (args) Object.assign(cmd, args);
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return (r.roles && r.roles[0]) || null;
    },
    getRoles(args) {
      var cmd = { rolesInfo: 1 };
      if (args) Object.assign(cmd, args);
      var r = JSON.parse(__runCommand(name, JSON.stringify(cmd)));
      return r.roles || [];
    },
    grantPrivilegesToRole(rolename, privileges) {
      return JSON.parse(__runCommand(name, JSON.stringify({ grantPrivilegesToRole: rolename, privileges: privileges || [] })));
    },
    revokePrivilegesFromRole(rolename, privileges) {
      return JSON.parse(__runCommand(name, JSON.stringify({ revokePrivilegesFromRole: rolename, privileges: privileges || [] })));
    },
    grantRolesToRole(rolename, roles) {
      return JSON.parse(__runCommand(name, JSON.stringify({ grantRolesToRole: rolename, roles: roles || [] })));
    },
    revokeRolesFromRole(rolename, roles) {
      return JSON.parse(__runCommand(name, JSON.stringify({ revokeRolesFromRole: rolename, roles: roles || [] })));
    },
  };

  // Proxy so db.collName works as db.getCollection("collName")
  return new Proxy(d, {
    get(target, key) {
      if (key in target) return target[key];
      // Skip Symbol and internal JS properties
      if (typeof key === "symbol") return undefined;
      if (key === "then" || key === "catch" || key === "finally") return undefined;
      return makeColl(name, key);
    },
  });
}

// ── db global ─────────────────────────────────────────────────────────────────
var db = makeDb(__DBNAME);

// ── rs.* (replication) ──────────────────────────────────────────────────────────
var rs = {
  status()  { return JSON.parse(__adminCommand(JSON.stringify({ replSetGetStatus: 1 }))); },
  conf()    { var r = JSON.parse(__adminCommand(JSON.stringify({ replSetGetConfig: 1 }))); return r.config || r; },
  config()  { return this.conf(); },
  initiate(cfg) { return JSON.parse(__adminCommand(JSON.stringify({ replSetInitiate: cfg || {} }))); },
  reconfig(cfg, opts) {
    var cmd = { replSetReconfig: cfg, force: !!(opts && opts.force) };
    return JSON.parse(__adminCommand(JSON.stringify(cmd)));
  },
  add(hostOrCfg, arbiterOnly) {
    var cfg = this.conf();
    var maxId = -1;
    for (var i = 0; i < cfg.members.length; i++) if (cfg.members[i]._id > maxId) maxId = cfg.members[i]._id;
    // Copy object input so we never mutate the caller's member object (aliasing).
    var member = (typeof hostOrCfg === "string") ? { _id: maxId + 1, host: hostOrCfg } : Object.assign({}, hostOrCfg);
    if (member._id === undefined) member._id = maxId + 1;
    if (arbiterOnly) member.arbiterOnly = true;
    cfg.members.push(member);
    cfg.version = (cfg.version || 1) + 1;
    return this.reconfig(cfg);
  },
  addArb(host) { return this.add(host, true); },
  remove(host) {
    var cfg = this.conf();
    cfg.members = cfg.members.filter(function (m) { return m.host !== host; });
    cfg.version = (cfg.version || 1) + 1;
    return this.reconfig(cfg);
  },
  freeze(secs)   { return JSON.parse(__adminCommand(JSON.stringify({ replSetFreeze: secs || 0 }))); },
  stepDown(secs, catchUp) {
    var cmd = { replSetStepDown: secs || 60 };
    if (catchUp !== undefined) cmd.secondaryCatchUpPeriodSecs = catchUp;
    return JSON.parse(__adminCommand(JSON.stringify(cmd)));
  },
  syncFrom(host) { return JSON.parse(__adminCommand(JSON.stringify({ replSetSyncFrom: host }))); },
  // Best-effort: derived summaries printed to the console.
  printReplicationInfo()          { printjson(this.status()); },
  printSecondaryReplicationInfo() { printjson(this.status()); },
};

// ── sh.* (sharding) ─────────────────────────────────────────────────────────────
var sh = {
  status() {
    // Simplified: shard list + balancer state (mongosh's full formatted status reads config.*).
    return {
      shards: JSON.parse(__adminCommand(JSON.stringify({ listShards: 1 }))).shards || [],
      balancer: JSON.parse(__adminCommand(JSON.stringify({ balancerStatus: 1 }))),
    };
  },
  enableSharding(dbName, primaryShard) {
    var cmd = { enableSharding: dbName };
    if (primaryShard) cmd.primaryShard = primaryShard;
    return JSON.parse(__adminCommand(JSON.stringify(cmd)));
  },
  shardCollection(ns, key, unique, opts) {
    var cmd = Object.assign({ shardCollection: ns, key: key, unique: !!unique }, opts || {});
    return JSON.parse(__adminCommand(JSON.stringify(cmd)));
  },
  addShard(uri, name) {
    var cmd = { addShard: uri };
    if (name) cmd.name = name;
    return JSON.parse(__adminCommand(JSON.stringify(cmd)));
  },
  addShardToZone(shard, zone)      { return JSON.parse(__adminCommand(JSON.stringify({ addShardToZone: shard, zone: zone }))); },
  removeShardFromZone(shard, zone) { return JSON.parse(__adminCommand(JSON.stringify({ removeShardFromZone: shard, zone: zone }))); },
  updateZoneKeyRange(ns, min, max, zone) {
    return JSON.parse(__adminCommand(JSON.stringify({ updateZoneKeyRange: ns, min: min, max: max, zone: zone })));
  },
  moveChunk(ns, query, destination) {
    return JSON.parse(__adminCommand(JSON.stringify({ moveChunk: ns, find: query, to: destination })));
  },
  splitAt(ns, middle)  { return JSON.parse(__adminCommand(JSON.stringify({ split: ns, middle: middle }))); },
  splitFind(ns, query) { return JSON.parse(__adminCommand(JSON.stringify({ split: ns, find: query }))); },
  startBalancer()      { return JSON.parse(__adminCommand(JSON.stringify({ balancerStart: 1 }))); },
  stopBalancer()       { return JSON.parse(__adminCommand(JSON.stringify({ balancerStop: 1 }))); },
  getBalancerState()   { return !!JSON.parse(__adminCommand(JSON.stringify({ balancerStatus: 1 }))).inBalancerRound; },
  isBalancerRunning()  { return JSON.parse(__adminCommand(JSON.stringify({ balancerStatus: 1 }))); },
  enableAutoSplit()    { return JSON.parse(__adminCommand(JSON.stringify({ balancerCollectionStatus: 1 }))); },
  disableAutoSplit()   { return JSON.parse(__adminCommand(JSON.stringify({ balancerCollectionStatus: 1 }))); },
};

// ── __finalize ────────────────────────────────────────────────────────────────
// Called by the engine (Task 7) on the completion value of the user script.
// Returns a tagged object the engine maps to ResultDisplay.
//
// Tags:
//   { t: "cursorRef", kind, db, coll, q, o } — pure Cursor (no .map(), no {_id:0} projection,
//                                              no $out/$merge): a query recipe, NOT materialized.
//                                              The frontend re-runs it via query_page/aggregate.
//   { t: "cursor", pure, src, rows, capped } — Cursor (row cap applied in toArray() via __CAP/
//                                              __BYTE_CAP; `capped` flags early stop to the engine)
//   { t: "array",  rows }              — plain array
//   { t: "none" }                      — undefined, null, function
//   { t: "value",  json }              — any other value, serialized
//
// Every tag above also carries a sibling `explainHint: {kind, db, coll, q, o} | null` —
// the query of the single Cursor constructed during this run, if exactly one was (regardless of
// `.map()`/`.forEach()`/`.toArray()`). Zero or multiple Cursors constructed (loops, several
// queries) yields null: there is no single query left to explain.
//
// Note: "ack" (write-result) is reserved for Slice 2 write commands.
// Note: engine.rs's classify() still re-applies the row cap on `rows` as defense in depth, but
//       `capped` is the source of truth for whether the result was truncated (row OR byte cap).

// Scans a Canonical-ExtJSON aggregation pipeline (plain JS array of stage objects) for a
// top-level $out/$merge stage. Mirrors host.rs's own pipeline_writes check: the recipe bypass
// re-runs the pipeline on every count and every page turn, so a write stage must never take
// this path (it would re-run the write as a side effect of browsing results).
function _hasWriteStage(pipeline) {
  if (!Array.isArray(pipeline)) return false;
  for (var i = 0; i < pipeline.length; i++) {
    var stage = pipeline[i];
    if (stage && (Object.prototype.hasOwnProperty.call(stage, "$out") ||
                  Object.prototype.hasOwnProperty.call(stage, "$merge"))) {
      return true;
    }
  }
  return false;
}

function __explainHint() {
  if (__cursorsConstructed.length !== 1) return null;
  var cur = __cursorsConstructed[0];
  return { kind: cur._kind, db: cur._db, coll: cur._coll, q: cur._q, o: cur._o };
}

function __finalize(v) {
  // async functions parse fine (valid QuickJS syntax) but this engine never drains the
  // microtask queue, so their return value is always an unresolved Promise — surface that
  // plainly instead of letting an opaque object reach the grid/console.
  if (typeof Promise !== "undefined" && v instanceof Promise) {
    throw new Error(
      "Script returned an unresolved Promise — this engine runs synchronously (mongosh-style) and does not support async/await.",
    );
  }

  var explainHint = __explainHint();

  if (v instanceof Cursor) {
    var pipelineUnsafe = v._kind === "agg" && _hasWriteStage(v._q);
    // v._buf === null means the host query was never opened (no hasNext()/next() call yet).
    // If it HAS been opened, a row may already be buffered and a host handle may be open —
    // bypassing here would silently drop that row and leak the handle (toArray() is what
    // drains the buffer and closes the handle), so fall through to the materialize path.
    if (v._pure && !v._noId && !pipelineUnsafe && v._buf === null) {
      // Pure cursor, no .map(), no {_id:0} projection, no $out/$merge: return the query
      // "recipe" instead of materializing anything. The frontend pages this directly via
      // query_page/aggregate (Rust only) — no rows ever cross into QuickJS's JS heap.
      return { t: "cursorRef", kind: v._kind, db: v._db, coll: v._coll, q: v._q, o: v._o, explainHint: explainHint };
    }
    const rows = v.toArray();
    return {
      t: "cursor",
      pure: v._pure && !v._noId,
      src: { db: v._db, coll: v._coll },
      rows: rows,
      capped: v._capped,
      explainHint: explainHint,
    };
  }

  if (Array.isArray(v)) {
    return { t: "array", rows: v, explainHint: explainHint };
  }

  if (v === undefined || v === null || typeof v === "function") {
    return { t: "none", explainHint: explainHint };
  }

  return { t: "value", json: JSON.stringify(v), explainHint: explainHint };
}
