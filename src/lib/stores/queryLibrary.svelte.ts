import { loadQueryLibrary, saveQueryLibrary } from "../api/queryLibrary";
import { errorMessage } from "../api/errors";
import { canMove, descendantIds, nextId, type QueryNode } from "../domain/queryTree";

/** Global saved-query library (one per app, all connections share it). */
export function createQueryLibrary() {
  let nodes = $state<QueryNode[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);

  async function load() {
    try {
      nodes = await loadQueryLibrary();
      loadError = null;
    } catch (e) {
      // Corrupt file: show error, keep the library empty, and block writes so the file stays recoverable.
      loadError = errorMessage(e);
      nodes = [];
    }
    loaded = true;
  }

  /** Persist the whole list; on failure keep in-memory state and surface a non-blocking error. */
  async function persist() {
    try {
      await saveQueryLibrary($state.snapshot(nodes) as QueryNode[]);
      saveError = null;
    } catch (e) {
      saveError = errorMessage(e);
    }
  }

  async function saveQuery(
    name: string,
    statement: string,
    db: string | null,
    parentId: number | null,
  ): Promise<number | null> {
    if (loadError) return null;
    const id = nextId(nodes);
    nodes = [...nodes, { id, parentId, kind: "query", name, statement, db, updatedAt: Date.now() }];
    await persist();
    return id;
  }

  async function overwrite(id: number, statement: string, db: string | null) {
    if (loadError) return;
    nodes = nodes.map((n) =>
      n.id === id && n.kind === "query" ? { ...n, statement, db, updatedAt: Date.now() } : n,
    );
    await persist();
  }

  async function rename(id: number, name: string) {
    if (loadError) return;
    nodes = nodes.map((n) => (n.id === id ? { ...n, name } : n));
    await persist();
  }

  async function createFolder(name: string, parentId: number | null): Promise<number | null> {
    if (loadError) return null;
    const id = nextId(nodes);
    nodes = [...nodes, { id, parentId, kind: "folder", name }];
    await persist();
    return id;
  }

  async function remove(id: number) {
    if (loadError) return;
    const gone = new Set([id, ...descendantIds(nodes, id)]);
    nodes = nodes.filter((n) => !gone.has(n.id));
    await persist();
  }

  async function move(id: number, newParentId: number | null) {
    if (loadError) return;
    const node = nodes.find((n) => n.id === id);
    if (!node || node.parentId === newParentId || !canMove(nodes, id, newParentId)) return;
    nodes = nodes.map((n) => (n.id === id ? { ...n, parentId: newParentId } : n));
    await persist();
  }

  function queryName(id: number): string | null {
    const n = nodes.find((x) => x.id === id && x.kind === "query");
    return n?.name ?? null;
  }

  return {
    get nodes() { return nodes; },
    get loaded() { return loaded; },
    get loadError() { return loadError; },
    get saveError() { return saveError; },
    get blocked() { return loadError !== null; },
    load,
    saveQuery,
    overwrite,
    rename,
    createFolder,
    remove,
    move,
    queryName,
  };
}

/** App-wide singleton (tests build their own via createQueryLibrary). */
export const queryLibrary = createQueryLibrary();
