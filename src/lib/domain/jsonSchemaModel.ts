/** Pure model of a MongoDB `$jsonSchema` for the visual validator editor: parse / serialize both ways,
 *  sample-derived schemas, and immutable tree edits. Keywords the editor does not model live in `extra`. */
import type { BsonType } from "./extjson";
import type { CollectionSchema } from "./schema";

export interface SchemaNode {
  bsonType: string[];
  required: string[];
  properties: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  /** Every keyword the editor does not understand (oneOf, additionalProperties, title, …), kept verbatim. */
  extra: Record<string, unknown>;
}

/** Path to a node: property names from the root; `"[]"` steps into `items`. */
export type NodePath = readonly string[];
export const ITEMS = "[]";

export function emptyNode(): SchemaNode {
  return { bsonType: [], required: [], properties: {}, extra: {} };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const NUMERIC = ["minimum", "maximum", "minLength", "maxLength"] as const;

/** `$jsonSchema` value → tree. Total: anything unrecognised is kept in `extra` rather than dropped.
 *  A numeric keyword that is an Extended JSON wrapper (`{$numberLong: …}`) stays verbatim in `extra`
 *  (never passed through Number(), so no precision loss); only plain numbers fill the typed field.
 *  The round trip is exact except for normalisation: a one-element bsonType array becomes a string, and
 *  empty `required` / `properties` are dropped. Callers that must not rewrite a stored validator keep the
 *  original text and only serialise after an edit. */
export function parseJsonSchema(json: unknown): SchemaNode {
  const node = emptyNode();
  if (!isObj(json)) return node;
  for (const [k, v] of Object.entries(json)) {
    let ok = false;
    switch (k) {
      case "bsonType":
        if (typeof v === "string") { node.bsonType = [v]; ok = true; }
        else if (isStrArr(v)) { node.bsonType = [...v]; ok = true; }
        break;
      case "required":
        if (isStrArr(v)) { node.required = [...v]; ok = true; }
        break;
      case "properties":
        if (isObj(v) && Object.values(v).every(isObj)) {
          for (const [name, child] of Object.entries(v)) node.properties[name] = parseJsonSchema(child);
          ok = true;
        }
        break;
      case "items":
        if (isObj(v)) { node.items = parseJsonSchema(v); ok = true; }
        break;
      case "enum":
        if (Array.isArray(v)) { node.enum = [...v]; ok = true; }
        break;
      case "minimum": case "maximum": case "minLength": case "maxLength": {
        if (typeof v === "number") { node[k] = v; ok = true; }
        break;
      }
      case "pattern": case "description":
        if (typeof v === "string") { node[k] = v; ok = true; }
        break;
    }
    if (!ok) node.extra[k] = v;
  }
  return node;
}

/** Tree → `$jsonSchema` value (empty fields omitted; a single bsonType is written as a string). */
export function toJsonSchema(node: SchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.bsonType.length === 1) out.bsonType = node.bsonType[0];
  else if (node.bsonType.length > 1) out.bsonType = [...node.bsonType];
  if (node.description !== undefined) out.description = node.description;
  if (node.enum !== undefined) out.enum = node.enum;
  for (const k of ["minimum", "maximum", "minLength", "maxLength", "pattern"] as const) {
    if (node[k] !== undefined) out[k] = node[k];
  }
  if (node.required.length) out.required = [...node.required];
  const names = Object.keys(node.properties);
  if (names.length) {
    const props: Record<string, unknown> = {};
    for (const n of names) props[n] = toJsonSchema(node.properties[n]);
    out.properties = props;
  }
  if (node.items) out.items = toJsonSchema(node.items);
  return { ...node.extra, ...out };
}

const BSON_NAME: Partial<Record<BsonType, string>> = {
  binary: "binData", code: "javascript",
};
/** Our display type → `$jsonSchema` bsonType alias ("unknown" has none). */
function bsonName(t: BsonType): string | null {
  return t === "unknown" ? null : (BSON_NAME[t] ?? t);
}

/** Builds a schema from sampled field stats: a field present in ≥ `requiredThreshold` of the sample is required;
 *  a field seen with several types gets a bsonType array. Dotted paths nest as objects. */
export function fromSampledSchema(schema: CollectionSchema, opts: { requiredThreshold?: number } = {}): SchemaNode {
  const threshold = opts.requiredThreshold ?? 0.99;
  const root = emptyNode();
  root.bsonType = ["object"];
  for (const f of schema.fields) {
    const segs = f.path.split(".");
    let cur = root;
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1;
      let child = cur.properties[seg];
      if (!child) {
        child = emptyNode();
        if (!last) child.bsonType = ["object"];
        cur.properties[seg] = child;
      }
      if (last) {
        const names = (f.types?.length ? f.types : [f.type]).map(bsonName).filter((n): n is string => n !== null);
        // A leaf that is also a parent in other documents keeps "object" alongside its own type.
        child.bsonType = [...new Set([...names, ...(Object.keys(child.properties).length ? ["object"] : [])])];
        if (f.presence >= threshold) cur.required.push(seg);
      } else if (f.presence >= threshold && !cur.required.includes(seg)) {
        cur.required.push(seg);
      }
      cur = child;
    });
  }
  return root;
}

// ── immutable edits ──────────────────────────────────────────────────────────

function mapAt(node: SchemaNode, path: NodePath, fn: (n: SchemaNode) => SchemaNode): SchemaNode {
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path;
  if (head === ITEMS) return node.items ? { ...node, items: mapAt(node.items, rest, fn) } : node;
  const child = node.properties[head];
  return child ? { ...node, properties: { ...node.properties, [head]: mapAt(child, rest, fn) } } : node;
}

export function getAt(node: SchemaNode, path: NodePath): SchemaNode | undefined {
  let cur: SchemaNode | undefined = node;
  for (const seg of path) cur = seg === ITEMS ? cur?.items : cur?.properties[seg];
  return cur;
}

/** Shallow-merges `patch` into the node at `path`; a key set to `undefined` is cleared. */
export function updateAt(root: SchemaNode, path: NodePath, patch: Partial<SchemaNode>): SchemaNode {
  return mapAt(root, path, (n) => {
    const next = { ...n, ...patch };
    // A typed numeric edit supersedes a verbatim wrapper kept in `extra`.
    if (NUMERIC.some((k) => k in patch) && NUMERIC.some((k) => k in n.extra)) {
      const extra = { ...n.extra };
      for (const k of NUMERIC) if (k in patch) delete extra[k];
      next.extra = extra;
    }
    for (const k of Object.keys(patch) as (keyof SchemaNode)[]) if (next[k] === undefined) delete next[k];
    return next;
  });
}

export function addProperty(root: SchemaNode, path: NodePath, name: string): SchemaNode {
  return mapAt(root, path, (n) =>
    !name || name in n.properties ? n : { ...n, properties: { ...n.properties, [name]: { ...emptyNode(), bsonType: ["string"] } } });
}

export function removeProperty(root: SchemaNode, path: NodePath, name: string): SchemaNode {
  return mapAt(root, path, (n) => {
    const { [name]: _gone, ...rest } = n.properties;
    return { ...n, properties: rest, required: n.required.filter((r) => r !== name) };
  });
}

export function renameProperty(root: SchemaNode, path: NodePath, from: string, to: string): SchemaNode {
  return mapAt(root, path, (n) => {
    if (!to || from === to || !(from in n.properties) || to in n.properties) return n;
    const properties: Record<string, SchemaNode> = {};
    for (const [k, v] of Object.entries(n.properties)) properties[k === from ? to : k] = v;
    return { ...n, properties, required: n.required.map((r) => (r === from ? to : r)) };
  });
}

export function setRequired(root: SchemaNode, path: NodePath, name: string, on: boolean): SchemaNode {
  return mapAt(root, path, (n) => {
    const has = n.required.includes(name);
    if (on === has) return n;
    return { ...n, required: on ? [...n.required, name] : n.required.filter((r) => r !== name) };
  });
}

// ── validator document ───────────────────────────────────────────────────────

/** A collection validator is `{ $jsonSchema, …other query operators }`: split the schema from the rest. */
export function splitValidator(validator: unknown): { schema: unknown | null; rest: Record<string, unknown> } {
  if (!isObj(validator)) return { schema: null, rest: {} };
  const { $jsonSchema, ...rest } = validator;
  return { schema: $jsonSchema === undefined ? null : $jsonSchema, rest };
}

export function joinValidator(schema: unknown | null, rest: Record<string, unknown>): Record<string, unknown> {
  return schema === null ? { ...rest } : { $jsonSchema: schema, ...rest };
}

/** Filter matching documents that violate the whole validator (top-level operators included). */
export function violatorsFilter(validator: unknown): { $nor: [unknown] } {
  return { $nor: [validator] };
}

export interface TreeRow {
  path: NodePath;
  /** Property name, or `"[]"` for an array's items. */
  name: string;
  depth: number;
  node: SchemaNode;
  /** Required in its parent (always false for items). */
  required: boolean;
}

/** Depth-first rows of the field tree (root excluded) for rendering. */
export function flattenTree(root: SchemaNode): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (n: SchemaNode, path: NodePath, depth: number) => {
    for (const [name, child] of Object.entries(n.properties)) {
      const p = [...path, name];
      rows.push({ path: p, name, depth, node: child, required: n.required.includes(name) });
      walk(child, p, depth + 1);
    }
    if (n.items) {
      const p = [...path, ITEMS];
      rows.push({ path: p, name: ITEMS, depth, node: n.items, required: false });
      walk(n.items, p, depth + 1);
    }
  };
  walk(root, [], 0);
  return rows;
}

/** bsonType names offered in the type picker. */
export const BSON_TYPES = [
  "objectId", "string", "int", "long", "double", "decimal", "bool", "date",
  "object", "array", "binData", "null", "timestamp", "regex",
] as const;

/** Structural equality of parsed JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => k in (b as object) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** True when `$jsonSchema` exists but is not an object: the tree cannot represent it. */
export function schemaIsOpaque(schema: unknown | null): boolean {
  return schema !== null && (typeof schema !== "object" || Array.isArray(schema));
}
