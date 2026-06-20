import type { Doc } from "../domain/columns";

export type ContextKind = "host" | "database" | "collection" | "data" | "query";
export type CollectionSection = "info" | "indexes";

export type WorkTab = {
  id: number;
  kind: "document";
  db: string;
  coll: string;
  mode: "edit" | "insert";
  initial: Doc | null;
  idText: string | null;
};
export type WorkTabInit = Omit<WorkTab, "id">;

export type Active =
  | { zone: "context"; kind: ContextKind }
  | { zone: "work"; id: number }
  | null;

/** Nguồn sự thật cho tree selection + dải tab lai (context + work). */
export function createNavigation() {
  let selDb = $state<string | null>(null);
  let selColl = $state<string | null>(null);
  let active = $state<Active>(null);
  let connected = $state(false);
  let collectionSection = $state<CollectionSection>("info");
  let workTabs = $state<WorkTab[]>([]);
  let versions = $state<Record<string, number>>({});
  let nextId = 0;

  const key = (db: string, coll: string) => `${db}.${coll}`;

  const selection = $derived(selDb ? { db: selDb, coll: selColl } : null);
  const level = $derived<"none" | "db" | "coll">(selColl ? "coll" : selDb ? "db" : "none");
  const contextTabs = $derived<ContextKind[]>(
    !connected
      ? []
      : selColl
        ? ["host", "database", "collection", "data", "query"]
        : selDb
          ? ["host", "database"]
          : ["host"],
  );

  function selectDatabase(db: string) {
    selDb = db;
    selColl = null;
    active = { zone: "context", kind: "database" };
  }

  function selectCollection(db: string, coll: string) {
    selDb = db;
    selColl = coll;
    const prev = active;
    const keep = prev?.zone === "context" && (prev.kind === "collection" || prev.kind === "data");
    active = { zone: "context", kind: keep ? prev.kind : "data" };
  }

  function showContext(kind: ContextKind) {
    active = { zone: "context", kind };
  }

  function setCollectionSection(s: CollectionSection) {
    collectionSection = s;
  }

  function openDocument(init: WorkTabInit) {
    if (init.mode === "edit") {
      const existing = workTabs.find(
        (t) => t.mode === "edit" && t.db === init.db && t.coll === init.coll && t.idText === init.idText,
      );
      if (existing) {
        active = { zone: "work", id: existing.id };
        return;
      }
    }
    const tab: WorkTab = { id: nextId++, ...init };
    workTabs = [...workTabs, tab];
    active = { zone: "work", id: tab.id };
  }

  function activateWork(id: number) {
    active = { zone: "work", id };
  }

  function setConnected(v: boolean) {
    connected = v;
    if (!v) {
      selDb = null;
      selColl = null;
      active = null;
    }
  }

  function fallbackContext(): Active {
    if (contextTabs.length === 0) return null;
    return { zone: "context", kind: selColl ? "data" : selDb ? "database" : "host" };
  }

  function closeWork(id: number) {
    const idx = workTabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const wasActive = active?.zone === "work" && active.id === id;
    workTabs = workTabs.filter((t) => t.id !== id);
    if (wasActive) {
      const neighbor = workTabs[idx - 1] ?? workTabs[idx] ?? null;
      active = neighbor ? { zone: "work", id: neighbor.id } : fallbackContext();
    }
  }

  function collectionVersion(db: string, coll: string) {
    return versions[key(db, coll)] ?? 0;
  }

  function bumpCollection(db: string, coll: string) {
    const k = key(db, coll);
    versions = { ...versions, [k]: (versions[k] ?? 0) + 1 };
  }

  function closeForCollection(db: string, coll: string) {
    for (const t of workTabs.filter((t) => t.db === db && t.coll === coll)) closeWork(t.id);
    if (selDb === db && selColl === coll) {
      selColl = null;
      active = { zone: "context", kind: "database" };
    }
  }

  function closeForDatabase(db: string) {
    for (const t of workTabs.filter((t) => t.db === db)) closeWork(t.id);
    if (selDb === db) {
      selDb = null;
      selColl = null;
      active = null;
    }
  }

  function renameCollectionTabs(db: string, oldColl: string, newColl: string) {
    const affected = workTabs.some((t) => t.db === db && t.coll === oldColl);
    workTabs = workTabs.map((t) => (t.db === db && t.coll === oldColl ? { ...t, coll: newColl } : t));
    if (selDb === db && selColl === oldColl) selColl = newColl;
    if (affected) bumpCollection(db, newColl);
  }

  return {
    get selDb() { return selDb; },
    get selColl() { return selColl; },
    get selection() { return selection; },
    get level() { return level; },
    get active() { return active; },
    get connected() { return connected; },
    get contextTabs() { return contextTabs; },
    get collectionSection() { return collectionSection; },
    get workTabs() { return workTabs; },
    selectDatabase,
    setConnected,
    selectCollection,
    showContext,
    setCollectionSection,
    openDocument,
    activateWork,
    closeWork,
    collectionVersion,
    bumpCollection,
    closeForCollection,
    closeForDatabase,
    renameCollectionTabs,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createNavigation). */
export const navigation = createNavigation();
