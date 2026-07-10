import type { Doc } from "../domain/doc";

export type ContextKind = "host" | "database" | "collection" | "data";
export type CollectionSection = "info" | "indexes" | "schema";

export type DocumentTab = {
  id: number;
  kind: "document";
  sessionId: string;
  db: string;
  coll: string;
  mode: "edit" | "insert";
  initial: Doc | null;
  idText: string | null;
};
export type QueryTab = {
  id: number;
  kind: "query";
  sessionId: string;
  seq: number;
  initialStatement: string;
};
export type WorkTab = DocumentTab | QueryTab;
/** Document tab fields supplied by callers; `id` and `sessionId` are assigned by the manager. */
export type DocumentTabInit = Omit<DocumentTab, "id" | "sessionId">;

export type Active =
  | { zone: "context"; kind: ContextKind }
  | { zone: "work"; id: number }
  | null;

/** Per-session tree-selection slice; holds only selection + collection-section state (the shared tab strip lives in `sessionManager`). */
export function createSessionNav() {
  let selDb = $state<string | null>(null);
  let selColl = $state<string | null>(null);
  let connected = $state(false);
  let collectionSection = $state<CollectionSection>("info");
  let versions = $state<Record<string, number>>({});

  const key = (db: string, coll: string) => `${db}.${coll}`;

  const selection = $derived(selDb ? { db: selDb, coll: selColl } : null);
  const level = $derived<"none" | "db" | "coll">(selColl ? "coll" : selDb ? "db" : "none");
  const contextTabs = $derived<ContextKind[]>(
    !connected
      ? []
      : selColl
        ? ["host", "database", "collection", "data"]
        : selDb
          ? ["host", "database"]
          : ["host"],
  );

  function selectDatabase(db: string) {
    selDb = db;
    selColl = null;
  }

  function selectCollection(db: string, coll: string) {
    selDb = db;
    selColl = coll;
  }

  function setCollectionSection(s: CollectionSection) {
    collectionSection = s;
  }

  function setConnected(v: boolean) {
    connected = v;
    if (!v) {
      selDb = null;
      selColl = null;
    }
  }

  function clearCollection() {
    selColl = null;
  }

  function clearSelection() {
    selDb = null;
    selColl = null;
  }

  function setSelColl(coll: string | null) {
    selColl = coll;
  }

  function collectionVersion(db: string, coll: string) {
    return versions[key(db, coll)] ?? 0;
  }

  function bumpCollection(db: string, coll: string) {
    const k = key(db, coll);
    versions = { ...versions, [k]: (versions[k] ?? 0) + 1 };
  }

  return {
    get selDb() { return selDb; },
    get selColl() { return selColl; },
    get selection() { return selection; },
    get level() { return level; },
    get connected() { return connected; },
    get contextTabs() { return contextTabs; },
    get collectionSection() { return collectionSection; },
    selectDatabase,
    selectCollection,
    setCollectionSection,
    setConnected,
    clearCollection,
    clearSelection,
    setSelColl,
    collectionVersion,
    bumpCollection,
  };
}

export type SessionNav = ReturnType<typeof createSessionNav>;
