export type QueryFolder = { id: number; parentId: number | null; kind: "folder"; name: string };
export type SavedQuery = {
  id: number;
  parentId: number | null;
  kind: "query";
  name: string;
  statement: string;
  db: string | null;
  updatedAt: number; // epoch ms
};
export type QueryNode = QueryFolder | SavedQuery;

export type TreeRow = { node: QueryNode; depth: number };
export type FolderOption = { id: number | null; label: string };

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/** Children of `parentId`: folders first, then case-insensitive alphabetical. */
export function childrenOf(nodes: QueryNode[], parentId: number | null): QueryNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) =>
      a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : collator.compare(a.name, b.name),
    );
}

/** Depth-first visible rows; children of folders not in `expanded` are skipped. */
export function visibleRows(nodes: QueryNode[], expanded: ReadonlySet<number>): TreeRow[] {
  const out: TreeRow[] = [];
  function walk(parentId: number | null, depth: number) {
    for (const n of childrenOf(nodes, parentId)) {
      out.push({ node: n, depth });
      if (n.kind === "folder" && expanded.has(n.id)) walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

/** Same max(id)+1 scheme as connection ids. */
export function nextId(nodes: QueryNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
}

/** Ids of every node under `id` (any depth), excluding `id` itself. */
export function descendantIds(nodes: QueryNode[], id: number): number[] {
  const out: number[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/** Number of saved queries anywhere inside folder `folderId` (for the delete confirm). */
export function queryCountIn(nodes: QueryNode[], folderId: number): number {
  const inside = new Set(descendantIds(nodes, folderId));
  return nodes.filter((n) => n.kind === "query" && inside.has(n.id)).length;
}

/** False when target is the node itself, one of its descendants (cycle), a query node, or unknown. */
export function canMove(nodes: QueryNode[], id: number, newParentId: number | null): boolean {
  if (newParentId === null) return true;
  if (newParentId === id) return false;
  const target = nodes.find((n) => n.id === newParentId);
  if (!target || target.kind !== "folder") return false;
  return !descendantIds(nodes, id).includes(newParentId);
}

/** Root + all folders depth-first; labels are NBSP-indented for a flat <select>. */
export function folderOptions(nodes: QueryNode[], rootLabel: string): FolderOption[] {
  const out: FolderOption[] = [{ id: null, label: rootLabel }];
  function walk(parentId: number | null, depth: number) {
    for (const n of childrenOf(nodes, parentId)) {
      if (n.kind !== "folder") continue;
      out.push({ id: n.id, label: `${" ".repeat(depth * 3)}${n.name}` });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}
