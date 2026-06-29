<script lang="ts">
  import { idJson } from "$lib/domain/docid";
  import { aggregateTemplate } from "$lib/domain/queryStatement";
  import { inferSchema } from "$lib/domain/schema";
  import { buildSkeleton } from "$lib/domain/skeleton";
  import { sampleDocuments } from "$lib/api/documents";
  import { sessionManager } from "$lib/stores/sessionManager.svelte";
  import { getQueryRun, disposeQueryRun } from "$lib/stores/queryRuns.svelte";
  import { shell } from "$lib/stores/shell.svelte";
  import { activeDataView } from "$lib/stores/activeDataView.svelte";
  import { activity } from "$lib/stores/activity.svelte";
  import { quit } from "$lib/api/window";
  import type { Doc } from "$lib/domain/doc";
  import type { ContextKind, QueryTab as QueryTabType } from "$lib/stores/navigation.svelte";
  import SessionManager from "$lib/components/SessionManager.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import * as m from "$lib/paraglide/messages";
  import NamespacePanel from "$lib/components/NamespacePanel.svelte";
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

  const CONTEXT_LABEL: Record<ContextKind, string> = {
    host: "Host",
    database: "Database",
    collection: "Collection",
    data: "Data",
  };
  // Note: CONTEXT_LABEL uses English literals intentionally — these are structural keys
  // passed as tab labels to TabBar. They are not in the i18n scope of this task.

  let confirmQuit = $state(false);
  const requestQuit = () => (confirmQuit = true);

  const sm = sessionManager;
  // The whole UI is driven by the active session; in this task the sidebar still renders a
  // single tree (the active session's). Multi-root rendering arrives in Task 5.
  const session = $derived(sm.active);
  const nav = $derived(session?.nav ?? null);
  const tree = $derived(session?.tree ?? null);
  const host = $derived(session?.host ?? null);

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
  // Resolve the active query tab's run store (getQueryRun caches, so this is idempotent).
  // Reading it here keeps the toolbar's Run / Run-selection state reactive to editor changes.
  const activeQueryRun = $derived(
    activeQueryTab ? getQueryRun(activeQueryTab.id, activeQueryTab.sessionId, activeQueryTab.initialStatement) : null,
  );
  // Toolbar Edit/Export act on the collection data view, and only when it's the active context.
  const dataViewActive = $derived(active?.zone === "context" && active.kind === "data");

  async function onConnected(conn: { connId: number | null; label: string; uri: string; readOnly: boolean }): Promise<boolean> {
    // focusOrOpen is the sole owner of the backend connect call; it returns true on success.
    // Passing the real connId allows focusOrOpen to dedup saved connections (focus existing session).
    const ok = await sm.focusOrOpen({ connId: conn.connId, uri: conn.uri, label: conn.label, readOnly: conn.readOnly });
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

  async function doDisconnect() {
    const id = sm.activeId;
    for (const t of sm.workTabs.filter((t) => t.sessionId === id)) disposeQueryRun(t.id);
    if (id) await sm.closeSession(id);
    if (sm.sessions.length === 0) shell.setConnection(null);
    // Do not auto-open the session modal — the user reopens it manually when needed.
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

  // Horizontal splitter for the sidebar.
  function startSidebarDrag(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = shell.sidebarWidth;
    function move(ev: MouseEvent) {
      shell.setSidebarWidth(startW + (ev.clientX - startX));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Vertical splitter for the command log panel.
  function startLogDrag(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shell.logHeight;
    function move(ev: MouseEvent) {
      shell.setLogHeight(startH + (startY - ev.clientY));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
</script>

<div class="app">
  <TitleBar
    conn={shell.connection?.label ?? null}
    db={sel?.db ?? null}
    coll={sel?.coll ?? null}
    onquit={requestQuit}
  />
  <MenuBar
    connected={shell.connection !== null}
    onsession={() => shell.toggleSession()}
    onrefresh={doRefresh}
    onquit={requestQuit}
  />
  <Toolbar
    connected={shell.connection !== null}
    canNewDoc={sel?.coll != null}
    onsession={() => shell.toggleSession()}
    onrefresh={doRefresh}
    onnewdocument={newDocActive}
    onToggleLog={() => shell.toggleLog()}
    canRun={activeQueryRun != null}
    onrun={() => activeQueryRun?.run(sel?.db ?? null)}
    canRunSelection={activeQueryRun?.hasSelection ?? false}
    onrunselection={() => activeQueryRun?.runSelection(sel?.db ?? null)}
    canEditDoc={dataViewActive && (activeDataView.handle?.canEdit ?? false)}
    oneditdocument={() => activeDataView.handle?.editSelected()}
    canExport={dataViewActive ? (activeDataView.handle?.canExport ?? false) : false}
    onexport={() => (dataViewActive ? activeDataView.handle?.exportCurrent() : undefined)}
  />
  <div class="body">
    <aside style="width:{shell.sidebarWidth}px">
      <NamespacePanel
        connection={shell.connection}
        onselect={(d) => nav?.selectCollection(d.db, d.coll)}
        onselectdb={(d) => nav?.selectDatabase(d.db)}
        onnewquery={(d) => { nav?.selectCollection(d.db, d.coll); sm.openQuery(aggregateTemplate(d.coll)); }}
        onmanagesessions={() => shell.openSession()}
        ondisconnect={doDisconnect}
      />
    </aside>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="vsplit"
      role="separator"
      aria-orientation="vertical"
      tabindex="-1"
      onmousedown={startSidebarDrag}
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
        onCloseWork={(id) => { disposeQueryRun(id); sm.closeWork(id); }}
        onNewQuery={() => sm.openQuery(aggregateTemplate(""))}
      />
      <div class="panes">
        <!-- Mount only the active context pane (lazy), not all four hidden: eager mounting fired
             every pane's queries at once on each collection switch, wedging the connection. -->
        {#if active?.zone === "context" && active.kind === "host"}
          <div class="tabpane">
            <HostTab connection={shell.connection} />
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
          <div class="tabpane">
            {#key `${db}/${coll}#${nav?.collectionVersion(db, coll) ?? 0}`}
              <ResultTable {db} {coll} onopendocument={(doc, mode) => openDocument(db, coll, doc, mode)} />
            {/key}
          </div>
        {/if}
        {#each sm.workTabs as tab (tab.id)}
          <div class="tabpane" hidden={!(active?.zone === "work" && active.id === tab.id)}>
            {#if tab.kind === "query"}
              <QueryTab id={tab.id} seq={tab.seq} initialStatement={tab.initialStatement} currentDb={sel?.db ?? null} />
            {:else}
              <DocumentForm
                mode={tab.mode}
                db={tab.db}
                coll={tab.coll}
                initial={tab.initial}
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
          onmousedown={startLogDrag}
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
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
  .body { display: flex; flex: 1; min-height: 0; background: var(--bg); }
  aside { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-width: 0; background: var(--bg); overflow: hidden; }
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
