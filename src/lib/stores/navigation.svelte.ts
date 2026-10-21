import type { Doc } from "../domain/doc";

/** Which destination page the (single, non-closable) destination tab shows. */
export type Page = "host" | "database" | "collection";
/** The collection page's views, switched from the panel header. */
export type CollectionView = "data" | "schema" | "indexes" | "info";
export type HostSection = "info" | "currentOps" | "topology" | "users" | "roles";

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
  /** Saved-query library id this tab writes to on Save; null until first saved or when opened ad hoc. */
  savedQueryId: number | null;
};
/** Live change-stream recording of a collection, a database (`coll` null), the whole deployment
 *  (both null) or one document (`idText`). */
export type WatchTab = {
  id: number;
  kind: "watch";
  sessionId: string;
  db: string | null;
  coll: string | null;
  idText: string | null;
};
/** Compare / sync of two collections; `sessionId`/`db`/`coll` are the initial source side. */
export type CompareTab = {
  id: number;
  kind: "compare";
  sessionId: string;
  db: string;
  coll: string;
};
export type WorkTab = DocumentTab | QueryTab | WatchTab | CompareTab;
/** Watch tab fields supplied by callers. */
export type WatchTabInit = Omit<WatchTab, "id" | "kind" | "sessionId">;
/** Document tab fields supplied by callers; `id` and `sessionId` are assigned by the manager. */
export type DocumentTabInit = Omit<DocumentTab, "id" | "sessionId">;

export type Active =
  | { zone: "destination" }
  | { zone: "work"; id: number }
  | null;

/** Per-session tree-selection slice: selection + which destination page/view is shown (the shared tab strip lives in `sessionManager`). */
export function createSessionNav() {
  let selDb = $state<string | null>(null);
  let selColl = $state<string | null>(null);
  let connected = $state(false);
  // Explicit host choice; otherwise the page follows the selection depth.
  let hostChosen = $state(true);
  let collectionView = $state<CollectionView>("data");
  let hostSection = $state<HostSection>("info");
  let versions = $state<Record<string, number>>({});

  const key = (db: string, coll: string) => `${db}.${coll}`;

  const selection = $derived(selDb ? { db: selDb, coll: selColl } : null);
  const level = $derived<"none" | "db" | "coll">(selColl ? "coll" : selDb ? "db" : "none");
  const page = $derived<Page | null>(
    !connected ? null : hostChosen || !selDb ? "host" : selColl ? "collection" : "database",
  );

  function selectHost() {
    hostChosen = true;
  }

  function selectDatabase(db: string) {
    selDb = db;
    selColl = null;
    hostChosen = false;
  }

  function selectCollection(db: string, coll: string) {
    selDb = db;
    selColl = coll;
    hostChosen = false;
    collectionView = "data";
  }

  /** Switches the collection page's view — and shows that page (e.g. Mod+4 from the host overview). */
  function setCollectionView(v: CollectionView) {
    collectionView = v;
    if (selColl) hostChosen = false;
  }

  function setHostSection(s: HostSection) {
    hostSection = s;
  }

  function setConnected(v: boolean) {
    connected = v;
    hostChosen = true;
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
    hostChosen = true;
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
    get page() { return page; },
    get collectionView() { return collectionView; },
    get hostSection() { return hostSection; },
    selectHost,
    selectDatabase,
    selectCollection,
    setCollectionView,
    setHostSection,
    setConnected,
    clearCollection,
    clearSelection,
    setSelColl,
    collectionVersion,
    bumpCollection,
  };
}

export type SessionNav = ReturnType<typeof createSessionNav>;
