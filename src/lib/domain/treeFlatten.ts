/** Flatten documents + an expansion set into the visible rows of the Tree view.
 *  Pure: no Svelte, no Tauri. Row paths are `#<docIndex>` then dot segments. */
import type { Doc } from "./doc";
import { describeValue } from "./extjson";

export interface TreeRow {
  path: string;
  key: string;
  value: unknown;
  depth: number;
  docIndex: number;
  expandable: boolean;
  childCount: number | null;
}

/** Children as [key, value] pairs for plain containers; null for leaves (ExtJSON wrappers included). */
function childrenOf(value: unknown): [string, unknown][] | null {
  const type = describeValue(value).type;
  if (type === "array") return (value as unknown[]).map((v, i) => [String(i), v]);
  if (type === "object") return Object.entries(value as Record<string, unknown>);
  return null;
}

function pushNode(
  rows: TreeRow[], open: ReadonlySet<string>,
  path: string, key: string, value: unknown, depth: number, docIndex: number,
): void {
  const children = childrenOf(value);
  rows.push({
    path, key, value, depth, docIndex,
    expandable: children !== null && children.length > 0,
    childCount: children === null ? null : children.length,
  });
  if (children !== null && open.has(path)) {
    for (const [k, v] of children) pushNode(rows, open, `${path}.${k}`, k, v, depth + 1, docIndex);
  }
}

export function flattenDocs(docs: Doc[], open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  for (let i = 0; i < docs.length; i++) {
    const path = `#${i}`;
    const fields = Object.entries(docs[i]).filter(([k]) => k !== "_id");
    rows.push({ path, key: "", value: docs[i], depth: 0, docIndex: i, expandable: true, childCount: fields.length });
    if (open.has(path)) {
      for (const [k, v] of fields) pushNode(rows, open, `${path}.${k}`, k, v, 1, i);
    }
  }
  return rows;
}

/** "#0.address.city" -> "address.city"; a doc row ("#0") yields "". */
export function fieldPath(rowPath: string): string {
  const dot = rowPath.indexOf(".");
  return dot === -1 ? "" : rowPath.slice(dot + 1);
}

function collectExpandablePaths(value: unknown, path: string, acc: Set<string>): void {
  const children = childrenOf(value);
  if (children === null || children.length === 0) return;
  acc.add(path);
  for (const [k, v] of children) collectExpandablePaths(v, `${path}.${k}`, acc);
}

/** Every row path needed in `open` to fully expand one document at every depth ("Expand full depth"). */
export function fullDepthPaths(doc: Doc, docIndex: number): Set<string> {
  const path = `#${docIndex}`;
  const acc = new Set<string>([path]);
  const fields = Object.entries(doc).filter(([k]) => k !== "_id");
  for (const [k, v] of fields) collectExpandablePaths(v, `${path}.${k}`, acc);
  return acc;
}
