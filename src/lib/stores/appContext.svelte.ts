import { idJson } from "../domain/docid";
import { buildInsertSkeleton } from "./documentWrites";
import { getQueryRun } from "./queryRuns.svelte";
import { sessionManager } from "./sessionManager.svelte";
import { shell } from "./shell.svelte";
import { queryLibrary } from "./queryLibrary.svelte";
import { activeDataView } from "./activeDataView.svelte";
import { pickSavePath, pickFile } from "./desktop";
import { prefs } from "./prefs.svelte";
import { errorMessage } from "../api/errors";
import { saveDiagnostics } from "./diagnostics.svelte";
import { recentCollections } from "./recentCollections.svelte";
import { toast } from "./toast.svelte";
import { mcp } from "./mcp.svelte";
import { exposedSessions } from "../domain/mcp";
import * as m from "#lib/paraglide/messages.js";
import { untrack } from "svelte";
import type { Doc } from "../domain/doc";
import type { ConnectRequest } from "./connections.svelte";
import { vault } from "./vault.svelte";
import type { Environment } from "../domain/environment";
import type { SavedQuery } from "../domain/queryTree";
import type { HistoryEntry } from "../domain/queryHistory";
import type { CollectionView, QueryTab as QueryTabType } from "./navigation.svelte";

/** The app-level state of the main page — which session/tab/view is in focus, which dialogs are open — and the
 *  navigation/file actions built on it. Created once by `+page.svelte` and handed to its shell, shortcut and dialog components. */
export function createAppContext() {
  const sm = sessionManager;

  // The whole UI is driven by the active session; sidebar still renders a single tree (multi-root rendering arrives later).
  const session = $derived(sm.active);
  const nav = $derived(session?.nav ?? null);
  const tree = $derived(session?.tree ?? null);
  const host = $derived(session?.host ?? null);
  const readOnly = $derived(session?.readOnly ?? false);

  const active = $derived(sm.activeZone);
  const sel = $derived(nav?.selection ?? null);
  // Environment of the session in focus: a work tab's own session, otherwise the active session.
  const focusEnv = $derived.by((): Environment => {
    const a = active;
    if (a?.zone === "work") {
      const sid = sm.workTabs.find((t) => t.id === a.id)?.sessionId;
      return sm.sessions.find((s) => s.id === sid)?.environment ?? "";
    }
    return sm.active?.environment ?? "";
  });
  const page = $derived(nav?.page ?? null);
  const collectionView = $derived<CollectionView>(nav?.collectionView ?? "data");
  const onDestination = $derived(active?.zone === "destination");
  // The destination tab names what it shows: the collection / database, or the connection for the host page.
  const destination = $derived(
    page === null
      ? null
      : {
          page,
          label:
            page === "collection" && sel?.coll ? `${sel.db}.${sel.coll}` : page === "database" && sel ? sel.db : (session?.label ?? ""),
        },
  );
  const queryActive = $derived(
    active?.zone === "work" &&
      sm.workTabs.find((t) => t.id === active.id)?.kind === "query",
  );
  const activeQueryTab = $derived(
    active?.zone === "work"
      ? ((sm.workTabs.find((t) => t.id === active.id && t.kind === "query") ?? null) as QueryTabType | null)
      : null,
  );
  // Resolve the active query tab's run store (getQueryRun caches) to keep the toolbar's Run state reactive.
  const activeQueryRun = $derived(
    activeQueryTab ? getQueryRun(activeQueryTab.id, activeQueryTab.sessionId, activeQueryTab.initialStatement) : null,
  );
  // Single source of truth for which query tab's registered handle activeDataView.handle resolves to.
  $effect(() => {
    activeDataView.setActiveQueryId(activeQueryTab?.id ?? null);
  });
  // Toolbar Edit/Export act on the collection data view, and only when it's the active context.
  const dataViewActive = $derived(onDestination && page === "collection" && collectionView === "data");
  // The activeDataView bridge is also registered by the active Query tab's result grid, so widen the gate to cover both.
  const canUseDataView = $derived(dataViewActive || queryActive);

  // MCP clients see exactly the connections that are open here, labelled the same way.
  $effect(() => mcp.syncSessions(exposedSessions(sm.sessions)));

  // Collections opened lately feed the palette's "Recent" group.
  $effect(() => {
    const s = sel;
    if (s?.coll) untrack(() => recentCollections.touch(sm.active?.connId ?? null, s.db, s.coll!));
  });

  // ── Dialog flags (rendered by AppDialogs) ──
  let confirmQuit = $state(false);
  let aboutOpen = $state(false);
  let mcpOpen = $state(false);
  let auditOpen = $state(false);
  let paletteOpen = $state(false);
  let shortcutsOpen = $state(false);
  let saveQueryDialog = $state<{ tabId: number } | null>(null);
  let confirmReset = $state(false);
  // The sidebar's panel (rendered by AppShell), kept here so the File > Import command can reach it.
  let namespacePanelRef = $state<{ startImport(sessionId: string, db: string, coll: string | null): void } | undefined>();

  async function onConnected(conn: ConnectRequest): Promise<boolean> {
    // A saved connection's secrets are sealed while the vault is locked: ask for the master password first.
    if (conn.connId != null && vault.blocksConnect()) return false;
    // focusOrOpen is the sole owner of the backend connect call; passing the real connId lets it dedup saved connections.
    const ok = await sm.focusOrOpen({ connId: conn.connId, uri: conn.uri, label: conn.label, readOnly: conn.readOnly, ssh: conn.ssh, environment: conn.environment, color: conn.color, mcpAccess: conn.mcpAccess });
    if (ok) shell.setConnection(conn);
    return ok;
  }

  function openDocument(db: string, coll: string, doc: Doc | null, mode: "edit" | "insert") {
    sm.openDocument({
      kind: "document",
      db,
      coll,
      mode,
      initial: doc,
      idText: mode === "edit" && doc ? idJson(doc) : null,
    });
  }

  async function doRefresh() {
    await tree?.refresh();
    const s = nav?.selection;
    if (s?.coll) nav?.bumpCollection(s.db, s.coll);
  }

  /** Each work tab is bound to its own session, which may have a different DB selected than whatever session is currently focused. */
  function dbForSession(sessionId: string): string | null {
    return sm.sessions.find((s) => s.id === sessionId)?.nav.selection?.db ?? null;
  }

  async function doDisconnect(sessionId: string) {
    await sm.closeSession(sessionId);
    if (sm.sessions.length === 0) shell.setConnection(null);
    // Do not auto-open the session modal — the user reopens it manually when needed.
  }

  /** Toolbar Save / Ctrl+S for the active Query tab: overwrite when associated, else save-as dialog. */
  async function saveActiveQuery() {
    const tab = activeQueryTab;
    const run = activeQueryRun;
    if (!tab || !run || queryLibrary.blocked) return;
    // A deleted library node falls back to save-as (queryName returns null).
    if (tab.savedQueryId != null && queryLibrary.queryName(tab.savedQueryId) !== null) {
      await queryLibrary.overwrite(tab.savedQueryId, run.statementText, sel?.db ?? null);
      toast.push(queryLibrary.saveError ?? m.toast_query_updated(), queryLibrary.saveError ? "error" : "success");
    } else {
      saveQueryDialog = { tabId: tab.id };
    }
  }

  async function submitSaveQuery(name: string, parentId: number | null) {
    const d = saveQueryDialog;
    if (!d) return;
    const tab = sm.workTabs.find((t) => t.id === d.tabId && t.kind === "query") as QueryTabType | undefined;
    if (tab) {
      const run = getQueryRun(tab.id, tab.sessionId, tab.initialStatement);
      const id = await queryLibrary.saveQuery(name, run.statementText, sel?.db ?? null, parentId);
      if (id !== null) {
        sm.associateQueryTab(tab.id, id);
        toast.push(m.toast_query_saved(), "success");
      } else {
        toast.push(queryLibrary.loadError ?? m.toast_query_saved(), "error");
      }
    }
    saveQueryDialog = null;
  }

  /** Open a saved query: pre-select its remembered db when present, then open an associated tab. */
  function openSavedQuery(q: SavedQuery) {
    if (!sm.activeId) return;
    if (q.db && tree?.databases.some((db) => db.name === q.db)) nav?.selectDatabase(q.db);
    sm.openQuery(q.statement, q.id);
  }

  async function newDocActive() {
    const s = nav?.selection;
    if (!s?.coll) return;
    // Pre-fill all known fields (sampled schema) so the user only fills values; blank on failure.
    const initial = await buildInsertSkeleton(sm.active?.id ?? "", s.db, s.coll);
    openDocument(s.db, s.coll, initial, "insert");
  }

  /** Go to > Next/Previous tab: cycles the open work tabs (query/document), wrapping around. */
  function cycleWorkTab(dir: 1 | -1) {
    const tabs = sm.workTabs;
    if (tabs.length === 0) return;
    const idx = active?.zone === "work" ? tabs.findIndex((t) => t.id === active.id) : -1;
    const next = idx === -1 ? 0 : (idx + dir + tabs.length) % tabs.length;
    sm.activateWork(tabs[next].id);
  }

  function showCollectionView(v: CollectionView) {
    nav?.setCollectionView(v);
    sm.showDestination();
  }

  /** Re-opens a history entry on its own session (and database) in a new query tab. */
  function openHistoryEntry(e: HistoryEntry) {
    const s = sm.sessions.find((x) => (e.connId !== null ? x.connId === e.connId : x.label === e.sessionLabel));
    if (!s || s.status !== "connected") {
      toast.push(m.history_connect_first({ label: e.sessionLabel }), "error");
      return;
    }
    if (s.tree.databases.some((d) => d.name === e.db)) s.nav.selectDatabase(e.db);
    sm.openQuery(e.script, null, s.id);
  }

  async function exportDiagnosticsBundle() {
    const path = await pickSavePath("lumio-diagnostics.zip", "zip");
    if (!path) return;
    const error = await saveDiagnostics(path);
    if (error) toast.push(m.diagnostics_export_failed({ error }), "error");
    else toast.push(m.diagnostics_exported(), "success");
  }

  // "Reset to default": clears only the UI prefs, never saved connections/queries.
  async function doReset() {
    confirmReset = false;
    prefs.clear();
    await prefs.flush(); // must hit the disk before the reload re-reads it
    window.location.reload();
  }

  async function exportSettings() {
    const path = await pickSavePath("lumio-settings.json", "json");
    if (!path) return;
    try {
      await prefs.exportTo(path);
      toast.push(m.settings_exported(), "success");
    } catch (e) {
      toast.push(m.settings_export_failed({ error: errorMessage(e) }), "error");
    }
  }

  async function importSettings() {
    const path = await pickFile([{ name: "JSON", extensions: ["json"] }]);
    if (!path) return;
    try {
      await prefs.importFrom(path);
    } catch (e) {
      toast.push(m.settings_import_failed({ error: errorMessage(e) }), "error");
      return;
    }
    window.location.reload(); // every store re-reads its saved value on startup
  }

  return {
    get session() { return session; },
    get nav() { return nav; },
    get tree() { return tree; },
    get host() { return host; },
    get readOnly() { return readOnly; },
    get active() { return active; },
    get sel() { return sel; },
    get focusEnv() { return focusEnv; },
    get page() { return page; },
    get collectionView() { return collectionView; },
    get onDestination() { return onDestination; },
    get destination() { return destination; },
    get queryActive() { return queryActive; },
    get activeQueryTab() { return activeQueryTab; },
    get activeQueryRun() { return activeQueryRun; },
    get dataViewActive() { return dataViewActive; },
    get canUseDataView() { return canUseDataView; },
    get confirmQuit() { return confirmQuit; }, set confirmQuit(v: boolean) { confirmQuit = v; },
    get aboutOpen() { return aboutOpen; }, set aboutOpen(v: boolean) { aboutOpen = v; },
    get mcpOpen() { return mcpOpen; }, set mcpOpen(v: boolean) { mcpOpen = v; },
    get auditOpen() { return auditOpen; }, set auditOpen(v: boolean) { auditOpen = v; },
    get paletteOpen() { return paletteOpen; }, set paletteOpen(v: boolean) { paletteOpen = v; },
    get shortcutsOpen() { return shortcutsOpen; }, set shortcutsOpen(v: boolean) { shortcutsOpen = v; },
    get saveQueryDialog() { return saveQueryDialog; }, set saveQueryDialog(v: { tabId: number } | null) { saveQueryDialog = v; },
    get confirmReset() { return confirmReset; }, set confirmReset(v: boolean) { confirmReset = v; },
    get namespacePanelRef() { return namespacePanelRef; }, set namespacePanelRef(v) { namespacePanelRef = v; },
    onConnected,
    openDocument,
    doRefresh,
    dbForSession,
    doDisconnect,
    saveActiveQuery,
    submitSaveQuery,
    openSavedQuery,
    newDocActive,
    cycleWorkTab,
    showCollectionView,
    openHistoryEntry,
    exportDiagnosticsBundle,
    doReset,
    exportSettings,
    importSettings,
  };
}

export type AppContext = ReturnType<typeof createAppContext>;
