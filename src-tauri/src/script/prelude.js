// prelude.js — mongosh read shim for QuickJS
// Injected globals from Rust host:
//   __find, __aggregate, __count, __distinct, __runCommand, __listCollections
//   __cursorFetch, __cursorClose, __print
//   __DBNAME  (current database name string)
//
// All host fns accept/return Canonical Extended JSON strings.
// __find / __aggregate return: {"handle":<u32>,"rows":[<doc>,...],"exhausted":<bool>}
// __cursorFetch returns:       {"rows":[<doc>,...],"exhausted":<bool>}
// __count returns:             {"$numberLong":"<n>"}
// __distinct returns:          [<value>, ...]

"use strict";

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

class Cursor {
  constructor(db, coll, kind, query, opts) {
    this._db = db;
    this._coll = coll;
    this._kind = kind;
    this._q = query;      // filter doc (find) or pipeline array (agg)
    this._o = opts || {}; // find options: sort, limit, skip, projection, hint, maxTimeMS
    this._pure = true;    // false if .map() was called — disables inline-edit in the grid
    this._noId = false;   // true if projection excludes _id — also disables inline-edit
    // look-ahead buffer for hasNext/next
    this._buf = null;     // null = not opened yet; array when open
    this._handle = null;
    this._exhausted = false;
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

  // Materialize all rows into an array.
  toArray() {
    const r0 = this._open();
    const handle = r0.handle;
    const out = r0.rows.slice();
    let exhausted = r0.exhausted;
    while (!exhausted) {
      const b = JSON.parse(__cursorFetch(handle, 1000));
      out.push.apply(out, b.rows);
      exhausted = b.exhausted;
    }
    if (handle != null) { try { __cursorClose(handle); } catch (_) {} }
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
    }
  }

  hasNext() {
    this._ensureOpen();
    if (this._buf.length > 0) return true;
    if (this._exhausted) return false;
    // Fetch more
    const r = JSON.parse(__cursorFetch(this._handle, 100));
    this._buf = r.rows.slice();
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
    // Common admin shortcuts
    stats()           { return JSON.parse(__runCommand(name, JSON.stringify({ dbStats: 1 }))); },
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

// ── __finalize ────────────────────────────────────────────────────────────────
// Called by the engine (Task 7) on the completion value of the user script.
// Returns a tagged object the engine maps to ResultDisplay.
//
// Tags:
//   { t: "cursor", pure, src, rows }   — Cursor (no row cap here; Task 7 caps)
//   { t: "array",  rows }              — plain array
//   { t: "none" }                      — undefined, null, function
//   { t: "value",  json }              — any other value, serialized
//
// Note: "ack" (write-result) is reserved for Slice 2 write commands.
// Note: row capping is intentionally NOT applied here — Task 7's engine does it
//       so the cap value lives in one place (host.rs HostCtx::cap).

function __finalize(v) {
  if (v instanceof Cursor) {
    const rows = v.toArray();
    return {
      t: "cursor",
      pure: v._pure && !v._noId,
      src: { db: v._db, coll: v._coll },
      rows: rows,
    };
  }

  if (Array.isArray(v)) {
    return { t: "array", rows: v };
  }

  if (v === undefined || v === null || typeof v === "function") {
    return { t: "none" };
  }

  return { t: "value", json: JSON.stringify(v) };
}
