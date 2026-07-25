/** Flattens a single editable document into virtualized tree rows, plus generic immutable path-based mutation. Pure: no Svelte, no Tauri. */
import type { Doc } from "./doc";
import { containerKind } from "./extjson";
import { getBySegments } from "./schema";

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

/** Count of a container's children plus whether it's an array, without materializing entries — cheap even for huge containers. */
function childCountOf(value: unknown): { count: number; isArray: boolean } | null {
  const kind = containerKind(value);
  if (kind === "array") return { count: (value as unknown[]).length, isArray: true };
  if (kind === "object") return { count: Object.keys(value as Record<string, unknown>).length, isArray: false };
  return null;
}

/** Children as ordered [key,value] entries for plain containers; null for leaves. Only called once a container is open. */
function childrenOf(value: unknown): ChildEntry[] | null {
  const kind = containerKind(value);
  if (kind === "array") return (value as unknown[]).map((v, i) => ({ key: String(i), value: v }));
  if (kind === "object") return Object.entries(value as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  return null;
}

function walk(
  rows: EditRow[], open: ReadonlySet<string>,
  value: unknown, segments: PathSegment[], path: string, depth: number, key: string, locked: boolean,
): void {
  const info = childCountOf(value);
  const expandable = info !== null && info.count > 0;
  rows.push({
    kind: "field", path, segments, key, value, depth,
    locked, removable: !locked,
    expandable, childCount: info === null ? null : info.count,
  });
  if (info === null || !open.has(path)) return;
  const children = childrenOf(value)!;
  for (const child of children) {
    const seg: PathSegment = info.isArray ? Number(child.key) : child.key;
    walk(rows, open, child.value, [...segments, seg], `${path}.${child.key}`, depth + 1, child.key, false);
  }
  if (!locked) {
    rows.push({ kind: "adder", path: `${path}.__add`, segments, depth: depth + 1, isArray: info.isArray });
  }
}

/** Flattens the document's own fields (depth 0) plus whatever's open beneath, ending with a root-level adder row; `lockedKeys` applies only at depth 0. */
export function flattenEditableDoc(root: Doc, open: ReadonlySet<string>, lockedKeys: string[]): EditRow[] {
  const rows: EditRow[] = [];
  for (const [key, value] of Object.entries(root)) {
    walk(rows, open, value, [key], key, 0, key, lockedKeys.includes(key));
  }
  rows.push({ kind: "adder", path: "__add", segments: [], depth: 0, isArray: false });
  return rows;
}

function collectExpandablePaths(value: unknown, path: string, acc: Set<string>): void {
  const info = childCountOf(value);
  if (info === null || info.count === 0) return;
  acc.add(path);
  for (const child of childrenOf(value)!) collectExpandablePaths(child.value, `${path}.${child.key}`, acc);
}

/** Every row path needed in `open` to fully expand the document at every depth ("Expand all"). */
export function allExpandablePaths(root: Doc): Set<string> {
  const acc = new Set<string>();
  for (const [key, value] of Object.entries(root)) collectExpandablePaths(value, key, acc);
  return acc;
}

export interface FieldMatch {
  path: string;
  segments: PathSegment[];
  key: string;
}

function collectFieldMatches(
  value: unknown, segments: PathSegment[], path: string, key: string, query: string, acc: FieldMatch[],
): void {
  if (key.toLowerCase().includes(query)) acc.push({ path, segments, key });
  const info = childCountOf(value);
  if (info === null) return;
  for (const child of childrenOf(value)!) {
    const seg: PathSegment = info.isArray ? Number(child.key) : child.key;
    collectFieldMatches(child.value, [...segments, seg], `${path}.${child.key}`, child.key, query, acc);
  }
}

/** Every field at any depth whose key contains `query` (case-insensitive). One pass over the
 *  whole document — meant to run once per search (debounced), not per keystroke while editing. */
export function findFieldMatches(root: Doc, query: string): FieldMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const acc: FieldMatch[] = [];
  for (const [key, value] of Object.entries(root)) collectFieldMatches(value, [key], key, key, q, acc);
  return acc;
}

/** Ancestor paths of `path` (excluding `path` itself) — add these to `open` to reveal it as a row. */
export function ancestorPathsOf(path: string): string[] {
  const parts = path.split(".");
  const acc: string[] = [];
  for (let i = 1; i < parts.length; i++) acc.push(parts.slice(0, i).join("."));
  return acc;
}

/** Read the value at a segment path (undefined if any intermediate segment is missing/a scalar). */
export function getAtPath(root: unknown, segments: readonly PathSegment[]): unknown {
  return getBySegments(root, segments);
}

/** Existing keys of the object at `segments` (empty for a missing/non-object value or an array). */
export function existingKeysAt(root: unknown, segments: readonly PathSegment[]): string[] {
  const v = getAtPath(root, segments);
  return v !== null && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as Record<string, unknown>) : [];
}

/** Immutably rebuilds `root` along `segments`, applying `atTarget` to whatever sits at that path
 *  (the container/value itself, not its parent) once segments run out. Shared recursion for
 *  setAtPath/removeAtPath/insertAtPath — they differ only in what `atTarget` does. */
function rebuildAlong(root: unknown, segments: readonly PathSegment[], atTarget: (node: unknown) => unknown): unknown {
  if (segments.length === 0) return atTarget(root);
  const [seg, ...rest] = segments;
  if (typeof seg === "number") {
    const arr = (root as unknown[]).slice();
    arr[seg] = rebuildAlong(arr[seg], rest, atTarget);
    return arr;
  }
  const obj = { ...(root as Record<string, unknown>) };
  obj[seg] = rebuildAlong(obj[seg], rest, atTarget);
  return obj;
}

/** Immutably replace the value at `segments` (empty segments = replace the whole root). */
export function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): unknown {
  return rebuildAlong(root, segments, () => value);
}

/** Immutably remove the key/index addressed by `segments` (must be non-empty). */
export function removeAtPath(root: unknown, segments: readonly PathSegment[]): unknown {
  const last = segments[segments.length - 1];
  return rebuildAlong(root, segments.slice(0, -1), (parent) => {
    if (typeof last === "number") {
      const arr = (parent as unknown[]).slice();
      arr.splice(last, 1);
      return arr;
    }
    const obj = { ...(parent as Record<string, unknown>) };
    delete obj[last];
    return obj;
  });
}

/** Immutably insert into the container at `segments` (empty = root): a keyed field for an object
 *  (`key` non-null) or an appended item for an array (`key` null). */
export function insertAtPath(root: unknown, segments: readonly PathSegment[], key: string | null, value: unknown): unknown {
  return rebuildAlong(root, segments, (node) =>
    key === null ? [...(node as unknown[]), value] : { ...(node as Record<string, unknown>), [key]: value },
  );
}
