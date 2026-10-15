<script lang="ts">
  import { onMount } from "svelte";
  import { idJson } from "#lib/domain/docid.js";
  import { detectGridFsBucket } from "#lib/domain/gridfsBucket.js";
  import { isGridfsFilesEmpty } from "#lib/stores/gridfsBucketProbe.svelte.js";
  import { aggregateTemplate } from "#lib/domain/queryStatement.js";
  import { buildInsertSkeleton } from "#lib/api/insertSkeleton.js";
  import { cancelScript } from "#lib/api/script.js";
  import { sessionManager } from "#lib/stores/sessionManager.svelte.js";
  import { getQueryRun } from "#lib/stores/queryRuns.svelte.js";
  import { shell } from "#lib/stores/shell.svelte.js";
  import { queryLibrary } from "#lib/stores/queryLibrary.svelte.js";
  import { activeDataView } from "#lib/stores/activeDataView.svelte.js";
  import { activeDocumentForm } from "#lib/stores/activeDocumentForm.svelte.js";
  import { activity } from "#lib/stores/activity.svelte.js";
  import { commandLog } from "#lib/stores/commandLog.svelte.js";
  import { quit } from "#lib/api/window.js";
  import type { Doc } from "#lib/domain/doc.js";
  import type { SshConnectInput } from "#lib/api/connection.js";
  import type { Environment } from "#lib/domain/environment.js";
  import type { SavedQuery } from "#lib/domain/queryTree.js";
  import type { CollectionView, HostSection, QueryTab as QueryTabType } from "#lib/stores/navigation.svelte.js";
  import { toolbarFor, type ViewKey } from "#lib/domain/toolbarLayout.js";
  import ViewSwitcher from "#lib/components/ViewSwitcher.svelte";
  import SessionManager from "#lib/components/SessionManager.svelte";
  import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import NamespacePanel from "#lib/components/NamespacePanel.svelte";
  import SavedQueriesPanel from "#lib/components/SavedQueriesPanel.svelte";
  import SaveQueryDialog from "#lib/components/SaveQueryDialog.svelte";
  import ResultTable from "#lib/components/ResultTable.svelte";
  import GridFsFilesPanel from "#lib/components/GridFsFilesPanel.svelte";
  import DocumentForm from "#lib/components/DocumentForm.svelte";
  import TabBar from "#lib/components/TabBar.svelte";
  import DatabaseCollectionsPanel from "#lib/components/DatabaseCollectionsPanel.svelte";
  import { createAxisDrag } from "#lib/components/axisDrag.js";
  import { lazyComponent } from "#lib/components/lazyComponent.svelte.js";
  import TitleBar from "#lib/components/TitleBar.svelte";
  import MenuBar from "#lib/components/MenuBar.svelte";
  import Toolbar from "#lib/components/Toolbar.svelte";
  import CommandPalette from "#lib/components/CommandPalette.svelte";
  import ShortcutsDialog from "#lib/components/ShortcutsDialog.svelte";
  import { namespacePaletteItems, parseNamespaceId, type PaletteItem } from "#lib/domain/palette.js";
  import { formatCombo } from "#lib/domain/shortcuts.js";
  import { settings } from "#lib/stores/settings.svelte.js";
  import { theme } from "#lib/stores/theme.svelte.js";
  import StatusBar from "#lib/components/StatusBar.svelte";
  import CommandLog from "#lib/components/CommandLog.svelte";
  import AboutDialog from "#lib/components/AboutDialog.svelte";
  import ToastHost from "#lib/components/ToastHost.svelte";
  import { undo } from "#lib/stores/undo.svelte.js";
  import { jobs } from "#lib/stores/jobs.svelte.js";
  import { toast } from "#lib/stores/toast.svelte.js";
  import { SHORTCUTS, type Command, type CommandId } from "#lib/domain/commands.js";
  import { matchesEvent, isDefaultWebviewAccelerator } from "#lib/domain/shortcuts.js";
  import { detectPlatform } from "#lib/stores/platform.js";
  import { isModalOpen } from "#lib/stores/modalStack.js";


  // The three heavy tab panes are the only reachers of CodeEditor (QueryTab's editor, HostTab's
  // user/role JSON editors, CollectionTab's index partial-filter/collation editors), so all three
  // must be dynamic for the ~300kB @codemirror stack to stay out of the eager startup chunk —
  // a single static importer anywhere would pull it back in. Same reasoning as CodeEditor's own
  // lazy `js-beautify` import; each pane is already mounted only while it is the active tab.
  const queryTabChunk = lazyComponent(() => import("#lib/components/QueryTab.svelte"));
  const hostTabChunk = lazyComponent(() => import("#lib/components/HostTab.svelte"));
  const collectionTabChunk = lazyComponent(() => import("#lib/components/CollectionTab.svelte"));

  let confirmQuit = $state(false);
  const requestQuit = () => (confirmQuit = true);
  let aboutOpen = $state(false);
  let paletteOpen = $state(false);
  let shortcutsOpen = $state(false);
  let saveQueryDialog = $state<{ tabId: number } | null>(null);
  let namespacePanelRef: NamespacePanel | undefined = $state();

  // "Reset to default": clears only UI-pref localStorage keys, never saved connections/queries.
  let confirmReset = $state(false);
  const requestReset = () => (confirmReset = true);
  function doReset() {
    confirmReset = false;
    localStorage.clear();
    window.location.reload();
  }

  onMount(() => {
    queryLibrary.load(); // once at app start; failure shows in the panel and never blocks the app
  });

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

  async function onConnected(conn: {
    connId: number | null; label: string; uri: string; readOnly: boolean; ssh: SshConnectInput | null;
    environment: Environment; color: string;
  }): Promise<boolean> {
    // focusOrOpen is the sole owner of the backend connect call; passing the real connId lets it dedup saved connections.
    const ok = await sm.focusOrOpen({ connId: conn.connId, uri: conn.uri, label: conn.label, readOnly: conn.readOnly, ssh: conn.ssh, environment: conn.environment, color: conn.color });
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

  // Shell splitters. The sidebar's dragged edge leads the pointer (sign 1); the two bottom-anchored
  // panels grow as the pointer moves back up the axis (sign -1). Clamping lives in shell's setters.
  const startSavedQueriesDrag = createAxisDrag("y", () => shell.savedQueriesHeight, (px) => shell.setSavedQueriesHeight(px), -1);
  const startSidebarDrag = createAxisDrag("x", () => shell.sidebarWidth, (px) => shell.setSidebarWidth(px));
  const startLogDrag = createAxisDrag("y", () => shell.logHeight, (px) => shell.setLogHeight(px), -1);

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

  const plat = detectPlatform();
  const shortcutHint = (id: CommandId) => (SHORTCUTS[id] ? formatCombo(SHORTCUTS[id]!, plat) : undefined);

  const commands: Partial<Record<CommandId, Command>> = $derived({
    "file.sessionManager": { disabled: false, run: () => shell.toggleSession() },
    "file.refresh": { disabled: shell.connection === null, run: doRefresh },
    "file.newQuery": { disabled: shell.connection === null, run: () => sm.openQuery(aggregateTemplate("")) },
    "file.newDocument": { disabled: !(sel?.coll != null && !readOnly), run: newDocActive },
    "file.import": {
      disabled: !(sel?.db != null && !readOnly),
      run: () => { if (sel?.db && sm.activeId) namespacePanelRef?.startImport(sm.activeId, sel.db, sel.coll); },
    },
    "file.export": {
      disabled: !(canUseDataView ? (activeDataView.handle?.canExport ?? false) : false),
      run: () => (canUseDataView ? activeDataView.handle?.exportCurrent() : undefined),
    },
    "file.quit": { disabled: false, run: requestQuit },
    "query.run": { disabled: activeQueryRun == null, run: () => activeQueryRun?.run(sel?.db ?? null, activeQueryTab?.sessionId) },
    "query.runSelection": { disabled: !(activeQueryRun?.hasSelection ?? false), run: () => activeQueryRun?.runSelection(sel?.db ?? null, activeQueryTab?.sessionId) },
    "query.stop": { disabled: !(activeQueryRun?.running ?? false), run: () => { if (sm.activeId) cancelScript(sm.activeId); } },
    "query.explain": { disabled: activeQueryRun == null, run: () => activeQueryRun?.explainAfterRun(sel?.db ?? null, activeQueryTab?.sessionId) },
    "query.aggregate": { disabled: !(sel?.coll != null), run: () => { if (sel?.coll) sm.openQuery(aggregateTemplate(sel.coll)); } },
    "query.save": {
      disabled: !(activeQueryTab ? !queryLibrary.blocked : (activeDocumentForm.handle?.canSave ?? false)),
      run: () => (activeQueryTab ? saveActiveQuery() : activeDocumentForm.handle?.save()),
    },
    "goto.nextTab": { disabled: !(sm.workTabs.length > 1), run: () => cycleWorkTab(1) },
    "goto.prevTab": { disabled: !(sm.workTabs.length > 1), run: () => cycleWorkTab(-1) },
    "view.closeWorkTab": {
      disabled: active?.zone !== "work",
      run: () => { if (active?.zone === "work") sm.closeWork(active.id); },
    },
    "goto.host": { disabled: page === null, run: () => { nav?.selectHost(); sm.showDestination(); } },
    "goto.database": { disabled: !sel, run: () => { if (sel) { nav?.selectDatabase(sel.db); sm.showDestination(); } } },
    "goto.data": { disabled: !sel?.coll, run: () => showCollectionView("data") },
    "goto.schema": { disabled: !sel?.coll, run: () => showCollectionView("schema") },
    "view.toggleLog": { disabled: false, run: () => (activeDataView.handle?.toggleLog ? activeDataView.handle.toggleLog() : shell.toggleLog()) },
    "view.toggleWrap": { disabled: false, run: () => settings.setWrapLongLines(!settings.wrapLongLines) },
    "view.toggleSavedQueries": { disabled: false, run: () => shell.toggleSavedQueries() },
    "view.resetToDefault": { disabled: false, run: requestReset },
    "help.about": { disabled: false, run: () => (aboutOpen = true) },
    "edit.undo": { disabled: undo.entries.length === 0 || undo.busy, run: () => void undo.undoLast() },
    "help.shortcuts": { disabled: false, run: () => (shortcutsOpen = true) },
    "grid.focusFilter": { disabled: !canUseDataView, run: () => activeDataView.handle?.focusSearch?.() },
    "view.commandPalette": { disabled: false, run: () => (paletteOpen = !paletteOpen) },
  });

  function showCollectionView(v: CollectionView) {
    nav?.setCollectionView(v);
    sm.showDestination();
  }

  // ── Panel header: which view is showing, its switcher and its actions ──
  const viewKey = $derived.by((): ViewKey | null => {
    if (active?.zone === "work") return sm.workTabs.find((w) => w.id === active.id)?.kind === "query" ? "query" : "document";
    if (!onDestination || page === null) return null;
    return page === "collection" ? (`collection.${collectionView}` as ViewKey) : page;
  });
  // Log visibility follows the active view's own embedded log when it has one (query tab), else the docked panel.
  const logIsOpen = $derived(activeDataView.handle?.toggleLog ? (activeDataView.handle.logOpen ?? false) : shell.logOpen);
  // While the log is on screen, new commands are seen as they arrive.
  $effect(() => {
    void commandLog.entries.length;
    if (logIsOpen) commandLog.markSeen();
  });

  const headerEntries = $derived(viewKey ? toolbarFor(viewKey) : []);
  const COMMAND_LABELS = $derived<Partial<Record<CommandId, string>>>({
    "file.refresh": m.toolbar_refresh(),
    "file.import": m.toolbar_import(),
    "file.export": m.toolbar_export(),
    "file.newDocument": m.toolbar_new_document(),
    "file.newQuery": m.tab_bar_new_query(),
    "query.aggregate": m.toolbar_aggregate(),
    "query.save": m.toolbar_save(),
    "grid.focusFilter": m.toolbar_find_title(),
    "view.toggleWrap": m.wrap_toggle_label(),
    "view.toggleSavedQueries": m.toolbar_saved_queries(),
    "view.toggleLog": m.toolbar_command_log(),
  });
  const headerActive = $derived(
    new Set<CommandId>([
      ...(settings.wrapLongLines ? (["view.toggleWrap"] as const) : []),
      ...(shell.savedQueriesOpen ? (["view.toggleSavedQueries"] as const) : []),
    ]),
  );
  const COLLECTION_VIEWS = $derived([
    { key: "data", label: m.view_data() },
    { key: "schema", label: m.view_schema() },
    { key: "indexes", label: m.view_indexes() },
    { key: "info", label: m.view_info() },
  ]);
  const HOST_VIEWS = $derived([
    { key: "info", label: m.host_view_overview() },
    { key: "currentOps", label: m.host_tab_current_ops() },
    { key: "topology", label: m.host_tab_topology() },
    { key: "users", label: m.users_roles_toggle_users() },
    { key: "roles", label: m.users_roles_toggle_roles() },
  ]);
  // Go to menu: the destinations, with the Mod+1..4 hints where they have one.
  const gotoItems = $derived([
    { label: m.nav_overview(), id: "goto.host" as CommandId, checked: onDestination && page === "host" },
    { label: m.palette_group_databases(), id: "goto.database" as CommandId, checked: onDestination && page === "database" },
    { label: m.view_data(), id: "goto.data" as CommandId, checked: dataViewActive },
    { label: m.view_schema(), id: "goto.schema" as CommandId, checked: onDestination && page === "collection" && collectionView === "schema" },
  ].map((g) => ({ label: g.label, checked: g.checked, shortcut: shortcutHint(g.id), disabled: commands[g.id]?.disabled ?? true, run: () => commands[g.id]?.run() }))
    .concat(
      (["indexes", "info"] as const).map((v) => ({
        label: v === "indexes" ? m.view_indexes() : m.view_info(),
        checked: onDestination && page === "collection" && collectionView === v,
        shortcut: undefined,
        disabled: !sel?.coll,
        run: () => showCollectionView(v),
      })),
    ));

  // ── Command palette: every registry command + view toggles + saved queries + namespaces ──

  const PALETTE_COMMANDS: [CommandId, () => string, "actions" | "query" | "navigate" | "view"][] = [
    ["file.newQuery", m.tab_bar_new_query, "actions"],
    ["file.newDocument", m.menu_new_document, "actions"],
    ["file.refresh", m.menu_refresh, "actions"],
    ["file.import", m.menu_import, "actions"],
    ["file.export", m.menu_export, "actions"],
    ["file.sessionManager", m.menu_session_manager, "actions"],
    ["query.run", m.menu_run_query, "query"],
    ["query.runSelection", m.menu_run_selection, "query"],
    ["query.stop", m.menu_stop, "query"],
    ["query.explain", m.menu_explain, "query"],
    ["query.aggregate", m.menu_aggregate, "query"],
    ["query.save", m.menu_save_query, "query"],
    ["goto.host", m.nav_overview, "navigate"],
    ["goto.database", m.palette_group_databases, "navigate"],
    ["goto.data", m.view_data, "navigate"],
    ["goto.schema", m.view_schema, "navigate"],
    ["goto.nextTab", m.menu_next_tab, "navigate"],
    ["goto.prevTab", m.menu_previous_tab, "navigate"],
    ["view.resetToDefault", m.menu_reset_to_default, "view"],
    ["edit.undo", m.undo_last, "actions"],
    ["help.shortcuts", m.menu_keyboard_shortcuts, "view"],
    ["help.about", m.menu_about, "view"],
    ["file.quit", m.menu_quit, "view"],
  ];

  const VIEW_TOGGLES: Record<string, { label: () => string; run: () => void }> = {
    "toggle:theme": { label: m.palette_toggle_theme, run: () => theme.set(theme.current === "mocha" ? "latte" : "mocha") },
    "toggle:wrap": { label: m.palette_toggle_wrap, run: () => commands["view.toggleWrap"]?.run() },
    "toggle:log": { label: m.palette_toggle_log, run: () => commands["view.toggleLog"]?.run() },
    "toggle:saved": { label: m.palette_toggle_saved, run: () => commands["view.toggleSavedQueries"]?.run() },
    "density:compact": { label: () => `${m.menu_density()}: ${m.density_compact()}`, run: () => settings.setDensity("compact") },
    "density:comfortable": { label: () => `${m.menu_density()}: ${m.density_comfortable()}`, run: () => settings.setDensity("comfortable") },
    "density:spacious": { label: () => `${m.menu_density()}: ${m.density_spacious()}`, run: () => settings.setDensity("spacious") },
    "view:indexes": { label: m.view_indexes, run: () => { if (sel?.coll) showCollectionView("indexes"); } },
    "view:info": { label: m.view_info, run: () => { if (sel?.coll) showCollectionView("info"); } },
  };

  const paletteItems = $derived.by((): PaletteItem[] => {
    if (!paletteOpen) return [];
    const group = {
      actions: m.palette_group_actions(),
      query: m.palette_group_query(),
      navigate: m.palette_group_navigate(),
      view: m.palette_group_view(),
    };
    const cmds: PaletteItem[] = PALETTE_COMMANDS.map(([id, label, g]) => ({
      id,
      group: group[g],
      label: label(),
      shortcut: shortcutHint(id),
      disabled: commands[id]?.disabled ?? true,
    }));
    const toggles: PaletteItem[] = Object.entries(VIEW_TOGGLES).map(([id, t]) => ({ id, group: group.view, label: t.label() }));
    const saved: PaletteItem[] = sm.activeId
      ? queryLibrary.nodes
          .filter((n): n is SavedQuery => n.kind === "query")
          .map((q) => ({ id: `saved:${q.id}`, group: m.palette_group_saved(), label: q.name, detail: q.db ?? undefined }))
      : [];
    const ns = namespacePaletteItems(tree?.databases ?? [], {
      databases: m.palette_group_databases(),
      collections: m.palette_group_collections(),
    });
    // Namespaces first: jumping to a collection is the most common reason to open the palette.
    return [...ns, ...cmds, ...saved, ...toggles];
  });

  // Header breadcrumb: a document tab names its own namespace; a query tab has its own title row.
  const toolbarCrumb = $derived.by((): string[] => {
    if (active?.zone === "work") {
      const t = sm.workTabs.find((w) => w.id === active.id);
      if (!t || t.kind === "query") return [];
      return [t.db, t.coll];
    }
    if (page === "host") return [session?.label ?? ""];
    return [sel?.db, sel?.coll].filter((x): x is string => !!x);
  });

  const paletteContext = $derived(
    [shell.connection?.label, sel ? (sel.coll ? `${sel.db}.${sel.coll}` : sel.db) : null].filter((x): x is string => !!x),
  );

  function runPaletteItem(id: string) {
    const target = parseNamespaceId(id);
    if (target) {
      if (target.coll) nav?.selectCollection(target.db, target.coll);
      else nav?.selectDatabase(target.db);
      return;
    }
    if (id.startsWith("saved:")) {
      const q = queryLibrary.nodes.find((n): n is SavedQuery => n.kind === "query" && `saved:${n.id}` === id);
      if (q) openSavedQuery(q);
      return;
    }
    if (id in VIEW_TOGGLES) {
      VIEW_TOGGLES[id].run();
      return;
    }
    const c = commands[id as CommandId];
    if (c && !c.disabled) c.run();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    // "?" needs Shift on most layouts, so it can't go through the combo matcher; never while typing.
    if (e.key === "?" && !isModalOpen() && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest(".cm-editor") !== null);
      if (!typing) {
        e.preventDefault();
        shortcutsOpen = true;
        return;
      }
    }
    if (!isModalOpen() && !e.defaultPrevented) {
      for (const id of Object.keys(SHORTCUTS) as CommandId[]) {
        const combo = SHORTCUTS[id];
        if (!combo) continue;
        const c = commands[id];
        if (!c || c.disabled) continue;
        if (matchesEvent(combo, e, plat)) {
          // Mod+Z inside a text field / editor is the field's own undo, not the app's.
          if (id === "edit.undo") {
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest(".cm-editor") !== null)) continue;
          }
          e.preventDefault();
          c.run();
          return;
        }
      }
    }
    // Default webview accelerators (reload, find-on-page, print, devtools, zoom, history nav) are
    // blocked unconditionally — even while a modal is open, and regardless of whether the app has
    // its own shortcut on that key — since the app's own shortcut loop above always gets first
    // refusal and already returned if it handled the key.
    if (!e.defaultPrevented && isDefaultWebviewAccelerator(e, plat)) {
      e.preventDefault();
    }
  }}
/>

<div class="app">
  <TitleBar
    conn={shell.connection?.label ?? null}
    db={sel?.db ?? null}
    coll={sel?.coll ?? null}
    onquit={requestQuit}
    env={focusEnv}
    onpalette={() => (paletteOpen = true)}
    paletteHint={shortcutHint("view.commandPalette") ?? ""}
  >
    {#snippet menus()}
      <MenuBar {commands} goto={gotoItems} />
    {/snippet}
  </TitleBar>
  <div class="body">
    <aside style="width:{shell.sidebarWidth}px">
      <div class="ns-area">
        <NamespacePanel
          bind:this={namespacePanelRef}
          onselect={(d) => nav?.selectCollection(d.db, d.coll)}
          onselectdb={(d) => nav?.selectDatabase(d.db)}
          onnewquery={(d) => {
            sm.sessions.find((s) => s.id === d.sessionId)?.nav.selectCollection(d.db, d.coll);
            sm.openQuery(aggregateTemplate(d.coll), null, d.sessionId);
          }}
          onmanagesessions={() => shell.openSession()}
          ondisconnect={doDisconnect}
        />
      </div>
      {#if sm.sessions.length > 0}
        {#if shell.savedQueriesOpen}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="sq-split"
            role="separator"
            aria-orientation="horizontal"
            tabindex="-1"
            onpointerdown={startSavedQueriesDrag}
            onkeydown={() => {}}
          ></div>
        {/if}
        <SavedQueriesPanel onopen={openSavedQuery} />
      {/if}
    </aside>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="vsplit"
      role="separator"
      aria-orientation="vertical"
      tabindex="-1"
      onpointerdown={startSidebarDrag}
      onkeydown={() => {}}
    ></div>
    <section class:prod={focusEnv === "prod"}>
      <TabBar
        {destination}
        workTabs={sm.workTabs}
        sessions={sm.sessions}
        {active}
        onShowDestination={() => sm.showDestination()}
        onActivateWork={(id) => sm.activateWork(id)}
        onCloseWork={(id) => sm.closeWork(id)}
        onNewQuery={() => sm.openQuery(aggregateTemplate(""))}
      />
      {#if viewKey && viewKey !== "query"}
      <Toolbar
        {commands}
        entries={headerEntries}
        labels={COMMAND_LABELS}
        activeIds={headerActive}
        crumb={toolbarCrumb}
      >
        {#snippet switcher()}
          {#if onDestination && page === "collection"}
            <ViewSwitcher
              items={COLLECTION_VIEWS}
              value={collectionView}
              label={m.views_label()}
              onchange={(k) => nav?.setCollectionView(k as CollectionView)}
            />
          {:else if onDestination && page === "host"}
            <ViewSwitcher
              items={HOST_VIEWS}
              value={nav?.hostSection ?? "info"}
              label={m.views_label()}
              onchange={(k) => nav?.setHostSection(k as HostSection)}
            />
          {/if}
        {/snippet}
      </Toolbar>
      {/if}
      <div class="panes">
        <!-- Mount only the active context pane (lazy): eager mounting fired every pane's queries at once on each switch, wedging the connection. -->
        {#if onDestination && page === "host"}
          {@const HostTabView = hostTabChunk.value}
          <div class="tabpane">
            {#if HostTabView}
              {#key sm.activeId}
                <HostTabView connection={shell.connection} />
              {/key}
            {:else}
              <div class="empty">{m.status_bar_loading()}</div>
            {/if}
          </div>
        {/if}
        {#if onDestination && page === "database" && sel}
          {@const db = sel.db}
          <div class="tabpane">
            {#key db}
              <DatabaseCollectionsPanel {db} onopen={(c) => nav?.selectCollection(db, c)} />
            {/key}
          </div>
        {/if}
        {#if onDestination && page === "collection" && collectionView !== "data" && sel?.coll}
          {@const db = sel.db}
          {@const coll = sel.coll}
          {@const CollectionTabView = collectionTabChunk.value}
          <div class="tabpane">
            {#if CollectionTabView}
              {#key `${db}/${coll}#${nav?.collectionVersion(db, coll) ?? 0}`}
                <CollectionTabView {db} {coll} />
              {/key}
            {:else}
              <div class="empty">{m.status_bar_loading()}</div>
            {/if}
          </div>
        {/if}
        {#if dataViewActive && sel?.coll}
          {@const db = sel.db}
          {@const coll = sel.coll}
          {@const version = nav?.collectionVersion(db, coll) ?? 0}
          {@const siblingCollections = tree?.databases.find((d) => d.name === db)?.collections ?? []}
          {@const chunksSiblingMissing = coll.endsWith(".files") && !siblingCollections.includes(`${coll.slice(0, -".files".length)}.chunks`)}
          {@const filesIsEmpty = chunksSiblingMissing ? (isGridfsFilesEmpty(sm.activeId ?? "", db, coll) ?? false) : false}
          {@const bucket = detectGridFsBucket(siblingCollections, coll, filesIsEmpty)}
          <div class="tabpane">
            {#key `${sm.activeId}/${db}/${coll}#${version}`}
              {#if bucket}
                <GridFsFilesPanel {db} {bucket} {version} />
              {:else}
                <ResultTable {db} {coll} {version} onopendocument={(doc, mode) => openDocument(db, coll, doc, mode)} />
              {/if}
            {/key}
          </div>
        {/if}
        {#each sm.workTabs as tab (tab.id)}
          {@const isActiveTab = active?.zone === "work" && active.id === tab.id}
          <div class="tabpane" hidden={!isActiveTab}>
            {#if tab.kind === "query"}
              {@const QueryTabView = queryTabChunk.value}
              {#if QueryTabView}
                <QueryTabView id={tab.id} seq={tab.seq} initialStatement={tab.initialStatement}
                  sessionId={tab.sessionId} currentDb={dbForSession(tab.sessionId)} active={isActiveTab}
                  onsave={saveActiveQuery}
                  onopendocument={(doc: Doc, db: string, coll: string) => openDocument(db, coll, doc, "edit")} />
              {:else}
                <div class="empty">{m.status_bar_loading()}</div>
              {/if}
            {:else}
              <DocumentForm
                mode={tab.mode}
                db={tab.db}
                coll={tab.coll}
                initial={tab.initial}
                active={active?.zone === "work" && active.id === tab.id}
                onsaved={() => {
                  nav?.bumpCollection(tab.db, tab.coll);
                  sm.closeWork(tab.id);
                }}
                oncancel={() => sm.closeWork(tab.id)}
              />
            {/if}
          </div>
        {/each}
        {#if active === null}
          <div class="empty-state">
            <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--c-overlay1)" stroke-width="1.2">
              <ellipse cx="12" cy="5.6" rx="7" ry="3.6" />
              <path d="M5 5.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6M5 12c0 2 3 3.6 7 3.6s7-1.6 7-3.6" />
            </svg>
            <p>{m.page_empty_state()}</p>
            <button class="es-btn" onclick={() => (paletteOpen = true)}>
              {m.palette_open()}{#if shortcutHint("view.commandPalette")}<kbd>{shortcutHint("view.commandPalette")}</kbd>{/if}
            </button>
          </div>
        {/if}
      </div>
      {#if shell.logOpen && !queryActive}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="hsplit"
          role="separator"
          aria-orientation="horizontal"
          tabindex="-1"
          onpointerdown={startLogDrag}
          onkeydown={() => {}}
        ></div>
        <CommandLog height={shell.logHeight} onToggle={() => shell.toggleLog()} />
      {/if}
    </section>
  </div>

  <StatusBar
    connected={shell.connection !== null}
    connectionLabel={shell.connection?.label ?? null}
    dbCount={tree?.databases.length ?? 0}
    collCount={tree?.databases.reduce((n, d) => n + d.collections.length, 0) ?? 0}
    selDb={sel?.db ?? null}
    selColl={sel?.coll ?? null}
    version={host?.info?.version ?? null}
    uptimeSeconds={host?.info?.uptimeSeconds ?? null}
    serverTimeIso={host?.info?.localTimeIso ?? null}
    connectedAt={session?.connectedAt ?? null}
    activityLabel={activity.label}
    logOpen={logIsOpen}
    logUnseen={commandLog.unseen}
    ontogglelog={() => commands["view.toggleLog"]?.run()}
  />
  {#if shell.sessionOpen}
    <SessionManager onconnected={onConnected} onclose={() => shell.toggleSession()} />
  {/if}
  {#if confirmQuit}
    <ConfirmDialog
      title={m.page_quit_title()}
      message={jobs.running > 0 ? `${m.page_quit_message()} ${m.jobs_running_warning({ count: String(jobs.running) })}` : m.page_quit_message()}
      confirmLabel={m.page_quit_confirm()}
      cancelLabel={m.page_quit_cancel()}
      danger
      onconfirm={quit}
      oncancel={() => (confirmQuit = false)}
    />
  {/if}
  {#if saveQueryDialog}
    <SaveQueryDialog onsubmit={submitSaveQuery} oncancel={() => (saveQueryDialog = null)} />
  {/if}
  {#if confirmReset}
    <ConfirmDialog
      title={m.page_reset_default_title()}
      message={m.page_reset_default_message()}
      confirmLabel={m.page_reset_default_confirm()}
      danger
      onconfirm={doReset}
      oncancel={() => (confirmReset = false)}
    />
  {/if}
  {#if aboutOpen}
    <AboutDialog onclose={() => (aboutOpen = false)} />
  {/if}
  {#if shortcutsOpen}
    <ShortcutsDialog platform={plat} onclose={() => (shortcutsOpen = false)} />
  {/if}
  {#if paletteOpen}
    <CommandPalette
      items={paletteItems}
      context={paletteContext}
      onrun={runPaletteItem}
      onclose={() => (paletteOpen = false)}
    />
  {/if}
  <ToastHost />
  {#if undo.conflict}
    <ConfirmDialog
      title={m.undo_conflict_title()}
      message={m.undo_conflict_message()}
      confirmLabel={m.undo_overwrite()}
      danger
      onconfirm={() => undo.confirmOverwrite()}
      oncancel={() => undo.cancelOverwrite()}
    />
  {/if}
</div>

<style>
  /* Window chrome (title bar, sidebar, status bar) sits on --app-bg; the work area is an inset
     rounded panel on top of it — the Linear-style "sheet on a backdrop" layout. */
  .app { display: flex; flex-direction: column; height: 100vh; background: var(--app-bg); }
  .body { display: flex; flex: 1; min-height: 0; padding: 0 0.375rem 0 0; }
  aside { display: flex; flex-direction: column; min-width: 0; background: var(--app-bg); overflow: hidden; }
  .ns-area { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .sq-split { height: 0.375rem; flex: none; cursor: row-resize; background: transparent; }
  .sq-split:hover { background: var(--hover); }
  /* The sidebar splitter doubles as the gutter between sidebar and panel. */
  .vsplit { width: 0.375rem; flex: none; cursor: col-resize; background: transparent; }
  .vsplit:hover { background: color-mix(in srgb, var(--accent) 35%, transparent); }
  section {
    flex: 1; min-width: 0; display: flex; flex-direction: column;
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl);
    overflow: hidden; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  /* Production: a 2px red top edge on the main panel, always visible while working there. */
  section.prod { border-top: 2px solid var(--danger); }
  .panes { flex: 1; min-height: 0; position: relative; }
  .tabpane { height: 100%; }
  .tabpane[hidden] { display: none; }
  .empty { padding: 1.5rem; color: var(--muted); font-size: var(--fs); }
  .empty-state {
    height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.75rem; color: var(--muted); font-size: var(--fs);
  }
  .empty-state p { margin: 0; }
  .es-btn {
    display: inline-flex; align-items: center; gap: 0.625rem; height: 2rem; padding: 0 0.75rem;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);
    color: var(--c-subtext1); font-size: var(--fs); cursor: pointer;
  }
  .es-btn:hover { color: var(--fg); border-color: var(--c-surface1); }
  .es-btn kbd {
    font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); padding: 0.0625rem 0.3125rem;
    border-radius: var(--radius-sm); background: var(--hover); border: 1px solid var(--border);
  }
  .hsplit { height: 0.3125rem; flex: none; cursor: row-resize; background: var(--panel); border-top: 1px solid var(--border); }
  .hsplit:hover { background: var(--hover); }
</style>
