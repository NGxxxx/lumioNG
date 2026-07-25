<script lang="ts">
  import { onMount } from "svelte";
  import { idJson } from "$lib/domain/docid";
  import { rafThrottle } from "$lib/domain/rafThrottle";
  import { aggregateTemplate } from "$lib/domain/queryStatement";
  import { inferSchema } from "$lib/domain/schema";
  import { buildSkeleton } from "$lib/domain/skeleton";
  import { sampleDocuments } from "$lib/api/documents";
  import { cancelScript } from "$lib/api/script";
  import { sessionManager } from "$lib/stores/sessionManager.svelte";
  import { getQueryRun } from "$lib/stores/queryRuns.svelte";
  import { shell } from "$lib/stores/shell.svelte";
  import { queryLibrary } from "$lib/stores/queryLibrary.svelte";
  import { activeDataView } from "$lib/stores/activeDataView.svelte";
  import { activeDocumentForm } from "$lib/stores/activeDocumentForm.svelte";
  import { activity } from "$lib/stores/activity.svelte";
  import { quit } from "$lib/api/window";
  import type { Doc } from "$lib/domain/doc";
  import type { SshConnectInput } from "$lib/api/connection";
  import type { SavedQuery } from "$lib/domain/queryTree";
  import type { ContextKind, QueryTab as QueryTabType } from "$lib/stores/navigation.svelte";
  import SessionManager from "$lib/components/SessionManager.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import * as m from "$lib/paraglide/messages";
  import NamespacePanel from "$lib/components/NamespacePanel.svelte";
  import SavedQueriesPanel from "$lib/components/SavedQueriesPanel.svelte";
  import SaveQueryDialog from "$lib/components/SaveQueryDialog.svelte";
  import ResultTable from "$lib/components/ResultTable.svelte";
  import DocumentForm from "$lib/components/DocumentForm.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import CollectionTab from "$lib/components/CollectionTab.svelte";
  import DatabaseCollectionsPanel from "$lib/components/DatabaseCollectionsPanel.svelte";
  import HostTab from "$lib/components/HostTab.svelte";
  import QueryTab from "$lib/components/QueryTab.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import MenuBar from "$lib/components/MenuBar.svelte";
  import Toolbar from "$lib/components/Toolbar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import CommandLog from "$lib/components/CommandLog.svelte";
  import AboutDialog from "$lib/components/AboutDialog.svelte";
  import ToastHost from "$lib/components/ToastHost.svelte";
  import { toast } from "$lib/stores/toast.svelte";
  import { SHORTCUTS, type Command, type CommandId } from "$lib/domain/commands";
  import { matchesEvent, isDefaultWebviewAccelerator } from "$lib/domain/shortcuts";
  import { detectPlatform } from "$lib/stores/platform";
  import { isModalOpen } from "$lib/stores/modalStack";

  const CONTEXT_LABEL: Record<ContextKind, string> = {
    host: "Host",
    database: "Database",
    collection: "Collection",
    data: "Data",
  };
  // Note: CONTEXT_LABEL uses English literals intentionally — structural keys, not in i18n scope.

  let confirmQuit = $state(false);
  const requestQuit = () => (confirmQuit = true);
  let aboutOpen = $state(false);
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
  const navContextTabs = $derived(nav?.contextTabs ?? []);
  const contextTabs = $derived(navContextTabs.map((kind) => ({ kind, label: CONTEXT_LABEL[kind] })));
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
  const dataViewActive = $derived(active?.zone === "context" && active.kind === "data");
  // The activeDataView bridge is also registered by the active Query tab's result grid, so widen the gate to cover both.
  const canUseDataView = $derived(dataViewActive || queryActive);

  async function onConnected(conn: { connId: number | null; label: string; uri: string; readOnly: boolean; ssh: SshConnectInput | null }): Promise<boolean> {
    // focusOrOpen is the sole owner of the backend connect call; passing the real connId lets it dedup saved connections.
    const ok = await sm.focusOrOpen({ connId: conn.connId, uri: conn.uri, label: conn.label, readOnly: conn.readOnly, ssh: conn.ssh });
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

  // Vertical splitter above the Saved Queries panel (mirrors startLogDrag).
  function startSavedQueriesDrag(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shell.savedQueriesHeight;
    // Pointer capture: keeps pointermove/pointerup routed here (and auto-releases on pointerup)
    // even if the drag exits the window bounds, so `up()` always fires.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: coalesce raw pointermove ticks to at most one panel re-layout per frame.
    const move = rafThrottle((ev: PointerEvent) => {
      shell.setSavedQueriesHeight(startH + (startY - ev.clientY));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function newDocActive() {
    const s = nav?.selection;
    if (!s?.coll) return;
    // Pre-fill all known fields (sampled schema) so the user only fills values; blank on failure.
    let initial: Doc | null = null;
    try {
      const sample = await sampleDocuments(sm.active?.id ?? "", s.db, s.coll, "{}", 100);
      initial = buildSkeleton(inferSchema(sample).fields);
    } catch { /* fall back to an empty form */ }
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

  // Horizontal splitter for the sidebar.
  function startSidebarDrag(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = shell.sidebarWidth;
    // Pointer capture: keeps pointermove/pointerup routed here (and auto-releases on pointerup)
    // even if the drag exits the window bounds, so `up()` always fires.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: coalesce raw pointermove ticks to at most one sidebar re-layout per frame.
    const move = rafThrottle((ev: PointerEvent) => {
      shell.setSidebarWidth(startW + (ev.clientX - startX));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Vertical splitter for the command log panel.
  function startLogDrag(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shell.logHeight;
    // Pointer capture: keeps pointermove/pointerup routed here (and auto-releases on pointerup)
    // even if the drag exits the window bounds, so `up()` always fires.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: coalesce raw pointermove ticks to at most one log-panel re-layout per frame.
    const move = rafThrottle((ev: PointerEvent) => {
      shell.setLogHeight(startH + (startY - ev.clientY));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const plat = detectPlatform();

  const commands: Partial<Record<CommandId, Command>> = $derived({
    "file.sessionManager": { disabled: false, run: () => shell.toggleSession() },
    "file.refresh": { disabled: shell.connection === null, run: doRefresh },
    "file.newQuery": { disabled: shell.connection === null, run: () => sm.openQuery(aggregateTemplate("")) },
    "file.newDocument": { disabled: !(sel?.coll != null && !readOnly), run: newDocActive },
    "file.import": {
      disabled: !(sel?.coll != null && !readOnly),
      run: () => { if (sel?.coll && sm.activeId) namespacePanelRef?.startImport(sm.activeId, sel.db, sel.coll); },
    },
    "file.export": {
      disabled: !(canUseDataView ? (activeDataView.handle?.canExport ?? false) : false),
      run: () => (canUseDataView ? activeDataView.handle?.exportCurrent() : undefined),
    },
    "file.quit": { disabled: false, run: requestQuit },
    "query.run": { disabled: activeQueryRun == null, run: () => activeQueryRun?.run(sel?.db ?? null) },
    "query.runSelection": { disabled: !(activeQueryRun?.hasSelection ?? false), run: () => activeQueryRun?.runSelection(sel?.db ?? null) },
    "query.stop": { disabled: !(activeQueryRun?.running ?? false), run: () => { if (sm.activeId) cancelScript(sm.activeId); } },
    "query.explain": { disabled: activeQueryRun == null, run: () => activeQueryRun?.explainAfterRun(sel?.db ?? null) },
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
    "goto.host": { disabled: !navContextTabs.includes("host"), run: () => sm.showContext("host") },
    "goto.database": { disabled: !navContextTabs.includes("database"), run: () => sm.showContext("database") },
    "goto.collection": { disabled: !navContextTabs.includes("collection"), run: () => sm.showContext("collection") },
    "goto.data": { disabled: !navContextTabs.includes("data"), run: () => sm.showContext("data") },
    "view.resetToDefault": { disabled: false, run: requestReset },
    "help.about": { disabled: false, run: () => (aboutOpen = true) },
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (!isModalOpen() && !e.defaultPrevented) {
      for (const id of Object.keys(SHORTCUTS) as CommandId[]) {
        const combo = SHORTCUTS[id];
        if (!combo) continue;
        const c = commands[id];
        if (!c || c.disabled) continue;
        if (matchesEvent(combo, e, plat)) {
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
  />
  <MenuBar
    {commands}
    {contextTabs}
    activeContextKind={active?.zone === "context" ? active.kind : null}
    onshowcontext={(kind) => sm.showContext(kind)}
  />
  <Toolbar
    {commands}
    canNewDoc={sel?.coll != null && !readOnly}
    canEditDoc={canUseDataView && !readOnly && (activeDataView.handle?.canEdit ?? false)}
    oneditdocument={() => activeDataView.handle?.editSelected()}
    canDeleteDoc={canUseDataView && !readOnly && (activeDataView.handle?.canDelete ?? false)}
    ondeletedocument={() => activeDataView.handle?.deleteSelected()}
    canFind={canUseDataView}
    onfind={() => activeDataView.handle?.focusSearch?.()}
    onToggleLog={() => (activeDataView.handle?.toggleLog ? activeDataView.handle.toggleLog() : shell.toggleLog())}
    logOpen={activeDataView.handle?.toggleLog ? (activeDataView.handle.logOpen ?? false) : shell.logOpen}
    savedQueriesOpen={shell.savedQueriesOpen}
    onToggleSavedQueries={() => shell.toggleSavedQueries()}
  />
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
    <section>
      <TabBar
        {contextTabs}
        workTabs={sm.workTabs}
        sessions={sm.sessions}
        {active}
        onShowContext={(kind) => sm.showContext(kind)}
        onActivateWork={(id) => sm.activateWork(id)}
        onCloseWork={(id) => sm.closeWork(id)}
        onNewQuery={() => sm.openQuery(aggregateTemplate(""))}
      />
      <div class="panes">
        <!-- Mount only the active context pane (lazy): eager mounting fired every pane's queries at once on each switch, wedging the connection. -->
        {#if active?.zone === "context" && active.kind === "host"}
          <div class="tabpane">
            {#key sm.activeId}
              <HostTab connection={shell.connection} />
            {/key}
          </div>
        {/if}
        {#if active?.zone === "context" && active.kind === "database" && sel}
          {@const db = sel.db}
          <div class="tabpane">
            {#key db}
              <DatabaseCollectionsPanel {db} onopen={(c) => nav?.selectCollection(db, c)} />
            {/key}
          </div>
        {/if}
        {#if active?.zone === "context" && active.kind === "collection" && sel?.coll}
          {@const db = sel.db}
          {@const coll = sel.coll}
          <div class="tabpane">
            {#key `${db}/${coll}#${nav?.collectionVersion(db, coll) ?? 0}`}
              <CollectionTab {db} {coll} />
            {/key}
          </div>
        {/if}
        {#if active?.zone === "context" && active.kind === "data" && sel?.coll}
          {@const db = sel.db}
          {@const coll = sel.coll}
          {@const version = nav?.collectionVersion(db, coll) ?? 0}
          <div class="tabpane">
            {#key `${sm.activeId}/${db}/${coll}#${version}`}
              <ResultTable {db} {coll} {version} onopendocument={(doc, mode) => openDocument(db, coll, doc, mode)} />
            {/key}
          </div>
        {/if}
        {#each sm.workTabs as tab (tab.id)}
          {@const isActiveTab = active?.zone === "work" && active.id === tab.id}
          <div class="tabpane" hidden={!isActiveTab}>
            {#if tab.kind === "query"}
              <QueryTab id={tab.id} seq={tab.seq} initialStatement={tab.initialStatement}
                currentDb={dbForSession(tab.sessionId)} active={isActiveTab}
                onopendocument={(doc, db, coll) => openDocument(db, coll, doc, "edit")} />
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
          <div class="empty">{m.page_empty_state()}</div>
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
  />
  {#if shell.sessionOpen}
    <SessionManager onconnected={onConnected} onclose={() => shell.toggleSession()} />
  {/if}
  {#if confirmQuit}
    <ConfirmDialog
      title={m.page_quit_title()}
      message={m.page_quit_message()}
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
  <ToastHost />
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
  .body { display: flex; flex: 1; min-height: 0; background: var(--bg); }
  aside { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-width: 0; background: var(--bg); overflow: hidden; }
  .ns-area { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .sq-split { height: 0.3125rem; flex: none; cursor: row-resize; background: var(--bg); }
  .sq-split:hover { background: var(--hover); }
  .vsplit { width: 0.3125rem; flex: none; cursor: col-resize; background: var(--bg); }
  .vsplit:hover { background: var(--hover); }
  section { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  .panes { flex: 1; min-height: 0; position: relative; }
  .tabpane { height: 100%; }
  .tabpane[hidden] { display: none; }
  .empty { padding: 1.5rem; color: var(--muted); font-size: var(--fs); }
  .hsplit { height: 0.3125rem; flex: none; cursor: row-resize; background: var(--bg); }
  .hsplit:hover { background: var(--hover); }
</style>
