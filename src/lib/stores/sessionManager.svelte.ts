import { connect, disconnect } from "../api/connection";
import { createNamespaceTree } from "./namespaceTree.svelte";
import { createHostStatus } from "./hostStatus.svelte";
import { createSessionNav, type SessionNav, type WorkTab, type Active, type ContextKind, type DocumentTabInit } from "./navigation.svelte";
import { savedSessionId, adhocSessionId, adhocLabel, allocColor } from "../domain/session";
import { nextQuerySeq } from "../domain/queryseq";
import { commandLog } from "./commandLog.svelte";
import { connectCmd } from "../domain/mongosh";
import { maskUri } from "../domain/uri";

export type SessionStatus = "connecting" | "connected" | "error";
export type Session = {
  id: string;
  label: string;
  color: string;
  status: SessionStatus;
  connId: number | null;
  uri: string;
  connectedAt: number | null;
  nav: SessionNav;
  tree: ReturnType<typeof createNamespaceTree>;
  host: ReturnType<typeof createHostStatus>;
};

export function createSessionManager() {
  let sessions = $state<Session[]>([]);
  let activeId = $state<string | null>(null);
  let workTabs = $state<WorkTab[]>([]);
  let zone = $state<Active>(null);
  let nextTabId = 0;
  let adhocSeq = 0;

  const active = $derived(sessions.find((s) => s.id === activeId) ?? null);

  function navOf(sessionId: string): SessionNav | null {
    return sessions.find((s) => s.id === sessionId)?.nav ?? null;
  }

  // --- session-scoped tab cleanup (driven by each session's namespaceTree DDL) ---

  function closeForCollection(sessionId: string, db: string, coll: string) {
    for (const t of workTabs.filter((t) => t.kind === "document" && t.sessionId === sessionId && t.db === db && t.coll === coll)) {
      closeWork(t.id);
    }
    const nav = navOf(sessionId);
    if (nav && nav.selDb === db && nav.selColl === coll) {
      nav.clearCollection();
      // Mirror old navigation.closeForCollection: when the dropped collection is the one
      // being viewed in the active session, demote the context view to the Database tab
      // (not Host, which is closeWork's empty-state fallback).
      if (sessionId === activeId) zone = { zone: "context", kind: "database" };
    }
  }

  function closeForDatabase(sessionId: string, db: string) {
    for (const t of workTabs.filter((t) => t.kind === "document" && t.sessionId === sessionId && t.db === db)) {
      closeWork(t.id);
    }
    const nav = navOf(sessionId);
    if (nav && nav.selDb === db) {
      nav.clearSelection();
      // Mirror old navigation.closeForDatabase: when the dropped db is the one being
      // viewed in the active session, clear the context view (old code set active = null).
      if (sessionId === activeId) zone = null;
    }
  }

  function renameCollectionTabs(sessionId: string, db: string, oldColl: string, newColl: string) {
    const affected = workTabs.some(
      (t) => t.kind === "document" && t.sessionId === sessionId && t.db === db && t.coll === oldColl,
    );
    workTabs = workTabs.map((t) =>
      t.kind === "document" && t.sessionId === sessionId && t.db === db && t.coll === oldColl
        ? { ...t, coll: newColl }
        : t,
    );
    const nav = navOf(sessionId);
    if (nav && nav.selDb === db && nav.selColl === oldColl) nav.setSelColl(newColl);
    if (affected) nav?.bumpCollection(db, newColl);
  }

  function makeSession(id: string, label: string, connId: number | null, uri: string): Session {
    const color = allocColor(sessions.map((s) => s.color));
    const nav = createSessionNav();
    const tree = createNamespaceTree(id, {
      closeForCollection: (db, coll) => closeForCollection(id, db, coll),
      closeForDatabase: (db) => closeForDatabase(id, db),
      renameCollectionTabs: (db, oldColl, newColl) => renameCollectionTabs(id, db, oldColl, newColl),
    });
    return { id, label, color, status: "connecting", connId, uri, connectedAt: null, nav, tree, host: createHostStatus(id) };
  }

  async function focusOrOpen(p: { connId: number | null; uri: string; label: string }): Promise<boolean> {
    const id = p.connId != null ? savedSessionId(p.connId) : adhocSessionId(++adhocSeq);
    const existing = sessions.find((s) => s.id === id);
    if (existing) { activeId = id; return true; }
    const label = p.connId != null ? p.label : adhocLabel(adhocSeq);
    const s = makeSession(id, label, p.connId, p.uri);
    sessions = [...sessions, s];
    activeId = id;
    try {
      await connect(id, p.uri);
      commandLog.push(connectCmd(maskUri(p.uri)), id);
      s.status = "connected";
      s.connectedAt = Date.now();
      s.nav.setConnected(true);
      sessions = [...sessions];
      await s.tree.refresh();
      s.host.load(); // fire-and-forget; feeds Host tab + status bar
      return true;
    } catch {
      s.status = "error";
      sessions = [...sessions];
      return false;
    }
  }

  async function reconnect(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    s.status = "connecting"; sessions = [...sessions];
    try {
      await connect(id, s.uri);
      commandLog.push(connectCmd(maskUri(s.uri)), id);
      s.status = "connected";
      s.connectedAt = Date.now();
      s.nav.setConnected(true);
      sessions = [...sessions];
      await s.tree.refresh();
      s.host.load(); // fire-and-forget; feeds Host tab + status bar
    } catch {
      s.status = "error";
      sessions = [...sessions];
    }
  }

  function focusSession(id: string) {
    if (sessions.some((s) => s.id === id)) activeId = id;
  }

  async function closeSession(id: string) {
    await disconnect(id).catch(() => {});
    workTabs = workTabs.filter((t) => t.sessionId !== id);
    sessions = sessions.filter((s) => s.id !== id);
    if (activeId === id) {
      activeId = sessions.at(-1)?.id ?? null;
      if (activeId === null) zone = null;
    }
  }

  function openQuery(initialStatement: string) {
    if (!activeId) return;
    const used = workTabs.filter((t) => t.kind === "query").map((t) => t.seq);
    workTabs = [...workTabs, { id: nextTabId++, kind: "query", seq: nextQuerySeq(used), initialStatement, sessionId: activeId }];
    zone = { zone: "work", id: workTabs.at(-1)!.id };
  }

  function openDocument(init: DocumentTabInit) {
    if (!activeId) return;
    if (init.mode === "edit") {
      const dup = workTabs.find(
        (t) =>
          t.kind === "document" && t.mode === "edit" && t.sessionId === activeId &&
          t.db === init.db && t.coll === init.coll && t.idText === init.idText,
      );
      if (dup) { zone = { zone: "work", id: dup.id }; return; }
    }
    workTabs = [...workTabs, { id: nextTabId++, sessionId: activeId, ...init }];
    zone = { zone: "work", id: workTabs.at(-1)!.id };
  }

  function activateWork(tabId: number) {
    const t = workTabs.find((w) => w.id === tabId);
    if (!t) return;
    activeId = t.sessionId;
    zone = { zone: "work", id: tabId };
  }

  function closeWork(tabId: number) {
    const idx = workTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const wasActive = zone?.zone === "work" && zone.id === tabId;
    workTabs = workTabs.filter((t) => t.id !== tabId);
    if (wasActive) {
      const neighbor = workTabs[idx - 1] ?? workTabs[idx] ?? null;
      if (neighbor) { activeId = neighbor.sessionId; zone = { zone: "work", id: neighbor.id }; }
      else zone = active ? { zone: "context", kind: "host" } : null;
    }
  }

  function showContext(kind: ContextKind) {
    zone = { zone: "context", kind };
  }

  return {
    get sessions() { return sessions; },
    get active() { return active; },
    get activeId() { return activeId; },
    get workTabs() { return workTabs; },
    get activeZone() { return zone; },
    focusOrOpen,
    focusSession,
    reconnect,
    closeSession,
    openQuery,
    openDocument,
    activateWork,
    closeWork,
    showContext,
    closeForCollection,
    closeForDatabase,
    renameCollectionTabs,
  };
}

/** App-wide singleton (tests build their own via createSessionManager). */
export const sessionManager = createSessionManager();
