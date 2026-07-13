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
