import type { Doc } from "../domain/columns";

export type CollectionTab = { id: number; kind: "collection"; db: string; coll: string };
export type IndexTab = { id: number; kind: "index"; db: string; coll: string };
export type CollInfoTab = { id: number; kind: "collinfo"; db: string; coll: string };
export type DbStatsTab = { id: number; kind: "dbstats"; db: string };
export type DocumentTab = {
  id: number;
  kind: "document";
  db: string;
  coll: string;
  mode: "edit" | "insert";
  initial: Doc | null;
  idText: string | null;
};
export type Tab = CollectionTab | DocumentTab | IndexTab | CollInfoTab | DbStatsTab;
export type DocumentTabInit = Omit<DocumentTab, "id">;

export function createWorkspace() {
  let tabs = $state<Tab[]>([]);
  let activeId = $state<number | null>(null);
  let versions = $state<Record<string, number>>({});
  let nextId = 0;

  const key = (db: string, coll: string) => `${db}.${coll}`;

  function openCollection(db: string, coll: string) {
    const existing = tabs.find((t) => t.kind === "collection" && t.db === db && t.coll === coll);
    if (existing) {
      activeId = existing.id;
      return;
    }
    const tab: CollectionTab = { id: nextId++, kind: "collection", db, coll };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }

  function openIndexes(db: string, coll: string) {
    const existing = tabs.find((t) => t.kind === "index" && t.db === db && t.coll === coll);
    if (existing) {
      activeId = existing.id;
      return;
    }
    const tab: IndexTab = { id: nextId++, kind: "index", db, coll };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }

  function openCollectionInfo(db: string, coll: string) {
    const existing = tabs.find((t) => t.kind === "collinfo" && t.db === db && t.coll === coll);
    if (existing) {
      activeId = existing.id;
      return;
    }
    const tab: CollInfoTab = { id: nextId++, kind: "collinfo", db, coll };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }

  function openDatabaseStats(db: string) {
    const existing = tabs.find((t) => t.kind === "dbstats" && t.db === db);
    if (existing) {
      activeId = existing.id;
      return;
    }
    const tab: DbStatsTab = { id: nextId++, kind: "dbstats", db };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }

  function openDocument(init: DocumentTabInit) {
    if (init.mode === "edit") {
      const existing = tabs.find(
        (t) =>
          t.kind === "document" &&
          t.mode === "edit" &&
          t.db === init.db &&
          t.coll === init.coll &&
          t.idText === init.idText,
      );
      if (existing) {
        activeId = existing.id;
        return;
      }
    }
    const tab: DocumentTab = { id: nextId++, ...init };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }

  function close(id: number) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const wasActive = activeId === id;
    tabs = tabs.filter((t) => t.id !== id);
    if (wasActive) {
      const neighbor = tabs[idx - 1] ?? tabs[idx] ?? null;
      activeId = neighbor ? neighbor.id : null;
    }
  }

  function activate(id: number) {
    activeId = id;
  }

  function collectionVersion(db: string, coll: string) {
    return versions[key(db, coll)] ?? 0;
  }

  function bumpCollection(db: string, coll: string) {
    const k = key(db, coll);
    versions = { ...versions, [k]: (versions[k] ?? 0) + 1 };
  }

  function closeForCollection(db: string, coll: string) {
    for (const t of tabs.filter((t) => t.db === db && "coll" in t && t.coll === coll)) close(t.id);
  }

  function closeForDatabase(db: string) {
    for (const t of tabs.filter((t) => t.db === db)) close(t.id);
  }

  function renameCollectionTabs(db: string, oldColl: string, newColl: string) {
    const affected = tabs.some((t) => t.db === db && "coll" in t && t.coll === oldColl);
    tabs = tabs.map((t) => (t.db === db && "coll" in t && t.coll === oldColl ? { ...t, coll: newColl } : t));
    if (affected) bumpCollection(db, newColl);
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeId() {
      return activeId;
    },
    openCollection,
    openIndexes,
    openCollectionInfo,
    openDatabaseStats,
    openDocument,
    close,
    activate,
    collectionVersion,
    bumpCollection,
    closeForCollection,
    closeForDatabase,
    renameCollectionTabs,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createWorkspace). */
export const workspace = createWorkspace();
