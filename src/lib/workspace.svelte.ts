import type { Doc } from "./columns";

export type CollectionTab = { id: number; kind: "collection"; db: string; coll: string };
export type DocumentTab = {
  id: number;
  kind: "document";
  db: string;
  coll: string;
  mode: "edit" | "insert";
  initial: Doc | null;
  idText: string | null;
};
export type Tab = CollectionTab | DocumentTab;
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

  return {
    get tabs() {
      return tabs;
    },
    get activeId() {
      return activeId;
    },
    openCollection,
    openDocument,
    close,
    activate,
    collectionVersion,
    bumpCollection,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createWorkspace). */
export const workspace = createWorkspace();
