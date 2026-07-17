/** Flatten a single editable document into virtualized tree rows, plus generic immutable
 *  path-based mutation (object keys + array indices). Pure: no Svelte, no Tauri.
 *
 *  Unlike domain/treeFlatten.ts (multi-doc, read-only, doc-row wrapped), here the root object's
 *  own keys ARE the depth-0 rows — there's exactly one document being edited, so no wrapper row
 *  is needed. Containers default closed; only `open` paths get their children flattened in, which
 *  is what keeps opening a huge/deeply-nested document cheap (see DocumentForm.svelte). */
import type { Doc } from "./doc";
import { describeValue } from "./extjson";

/** Path segment: an object key (string) or array index (number). */
export type PathSegment = string | number;

export interface FieldRow {
  kind: "field";
  /** Dot-joined, display-only unique id (Svelte {#each} key / `open` + error-path Set member). */
  path: string;
  /** Key path from the document root — the authoritative address for get/set/remove/insert. */
  segments: PathSegment[];
  key: string;
  value: unknown;
  depth: number;
  locked: boolean;
  removable: boolean;
  expandable: boolean;
  childCount: number | null;
}

/** A synthetic trailing row offering "add field"/"add item" for an open container (or the root). */
export interface AdderRow {
  kind: "adder";
  path: string;
  /** Segments of the CONTAINER to insert into (empty = root document itself). */
  segments: PathSegment[];
  depth: number;
  isArray: boolean;
}

export type EditRow = FieldRow | AdderRow;

interface ChildEntry {
  key: string;
  value: unknown;
}

/** Children as ordered [key,value] entries for plain containers; null for leaves. */
function childrenOf(value: unknown): ChildEntry[] | null {
  const type = describeValue(value).type;
  if (type === "array") return (value as unknown[]).map((v, i) => ({ key: String(i), value: v }));
  if (type === "object") return Object.entries(value as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  return null;
}

function walk(
  rows: EditRow[], open: ReadonlySet<string>,
  value: unknown, segments: PathSegment[], path: string, depth: number, key: string, locked: boolean,
): void {
  const children = childrenOf(value);
  const expandable = children !== null && children.length > 0;
  rows.push({
    kind: "field", path, segments, key, value, depth,
    locked, removable: !locked,
    expandable, childCount: children === null ? null : children.length,
  });
  if (children === null || !open.has(path)) return;
  const isArray = Array.isArray(value);
  for (const child of children) {
    const seg: PathSegment = isArray ? Number(child.key) : child.key;
    walk(rows, open, child.value, [...segments, seg], `${path}.${child.key}`, depth + 1, child.key, false);
  }
  if (!locked) {
    rows.push({ kind: "adder", path: `${path}.__add`, segments, depth: depth + 1, isArray });
  }
}

/** Flatten the document's own fields (depth 0) plus whatever's open beneath them, ending with a
 *  root-level adder row. `lockedKeys` (e.g. `["_id"]`) applies only at depth 0, matching the old
 *  recursive TreeNode's behavior of never propagating locks into nested values. */
export function flattenEditableDoc(root: Doc, open: ReadonlySet<string>, lockedKeys: string[]): EditRow[] {
  const rows: EditRow[] = [];
  for (const [key, value] of Object.entries(root)) {
    walk(rows, open, value, [key], key, 0, key, lockedKeys.includes(key));
  }
  rows.push({ kind: "adder", path: "__add", segments: [], depth: 0, isArray: false });
  return rows;
}

/** Read the value at a segment path (undefined if any intermediate segment is missing/a scalar). */
export function getAtPath(root: unknown, segments: readonly PathSegment[]): unknown {
  let cur = root;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg as string];
  }
  return cur;
}

/** Existing keys of the object at `segments` (empty for a missing/non-object value or an array). */
export function existingKeysAt(root: unknown, segments: readonly PathSegment[]): string[] {
  const v = getAtPath(root, segments);
  return v !== null && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as Record<string, unknown>) : [];
}

/** Immutably replace the value at `segments` (empty segments = replace the whole root). */
export function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [seg, ...rest] = segments;
  if (typeof seg === "number") {
    const arr = (root as unknown[]).slice();
    arr[seg] = setAtPath(arr[seg], rest, value);
    return arr;
  }
  const obj = { ...(root as Record<string, unknown>) };
  obj[seg] = setAtPath(obj[seg], rest, value);
  return obj;
}

/** Immutably remove the key/index addressed by `segments` (must be non-empty). */
export function removeAtPath(root: unknown, segments: readonly PathSegment[]): unknown {
  const [seg, ...rest] = segments;
  if (rest.length === 0) {
    if (typeof seg === "number") {
      const arr = (root as unknown[]).slice();
      arr.splice(seg, 1);
      return arr;
    }
    const obj = { ...(root as Record<string, unknown>) };
    delete obj[seg];
    return obj;
  }
  if (typeof seg === "number") {
    const arr = (root as unknown[]).slice();
    arr[seg] = removeAtPath(arr[seg], rest);
    return arr;
  }
  const obj = { ...(root as Record<string, unknown>) };
  obj[seg] = removeAtPath(obj[seg], rest);
  return obj;
}

/** Immutably insert into the container at `segments` (empty = root): a keyed field for an object
 *  (`key` non-null) or an appended item for an array (`key` null). */
export function insertAtPath(root: unknown, segments: readonly PathSegment[], key: string | null, value: unknown): unknown {
  if (segments.length === 0) {
    if (key === null) return [...(root as unknown[]), value];
    return { ...(root as Record<string, unknown>), [key]: value };
  }
  const [seg, ...rest] = segments;
  if (typeof seg === "number") {
    const arr = (root as unknown[]).slice();
    arr[seg] = insertAtPath(arr[seg], rest, key, value);
    return arr;
  }
  const obj = { ...(root as Record<string, unknown>) };
  obj[seg] = insertAtPath(obj[seg], rest, key, value);
  return obj;
}
