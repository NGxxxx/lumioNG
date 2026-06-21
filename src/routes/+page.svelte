<script lang="ts">
  import { idJson } from "$lib/domain/docid";
  import { aggregateTemplate } from "$lib/domain/aggregate";
  import { navigation } from "$lib/stores/navigation.svelte";
  import { getQueryRun, disposeQueryRun } from "$lib/stores/queryRuns.svelte";
  import { namespaceTree } from "$lib/stores/namespaceTree.svelte";
  import { shell } from "$lib/stores/shell.svelte";
  import { hostStatus } from "$lib/stores/hostStatus.svelte";
  import { quit } from "$lib/api/window";
  import { disconnect as apiDisconnect } from "$lib/api/connection";
  import type { Doc } from "$lib/domain/columns";
  import type { ContextKind, QueryTab as QueryTabType } from "$lib/stores/navigation.svelte";
  import SessionManager from "$lib/components/SessionManager.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
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

  let confirmQuit = $state(false);
  const requestQuit = () => (confirmQuit = true);

  const active = $derived(navigation.active);
  const sel = $derived(navigation.selection);
  const contextTabs = $derived(navigation.contextTabs.map((kind) => ({ kind, label: CONTEXT_LABEL[kind] })));
  const queryActive = $derived(
    active?.zone === "work" &&
      navigation.workTabs.find((t) => t.id === active.id)?.kind === "query",
  );
  const activeQueryTab = $derived(
    active?.zone === "work"
      ? ((navigation.workTabs.find((t) => t.id === active.id && t.kind === "query") ?? null) as QueryTabType | null)
      : null,
  );

  async function onConnected(conn: { label: string; uri: string }) {
    shell.setConnection(conn);
    navigation.setConnected(true);
    await namespaceTree.refresh();
    hostStatus.load(); // fire-and-forget; feeds Host tab + status bar
  }

  function openDocument(db: string, coll: string, doc: Doc | null, mode: "edit" | "insert") {
    navigation.openDocument({
      kind: "document",
      db,
      coll,
      mode,
      initial: doc,
      idText: mode === "edit" && doc ? idJson(doc) : null,
    });
  }

  async function doRefresh() {
    await namespaceTree.refresh();
    const s = navigation.selection;
    if (s?.coll) navigation.bumpCollection(s.db, s.coll);
  }

  async function doDisconnect() {
    try {
      await apiDisconnect();
    } finally {
      for (const t of [...navigation.workTabs]) { disposeQueryRun(t.id); navigation.closeWork(t.id); }
      navigation.setConnected(false);
      shell.setConnection(null);
      namespaceTree.clear();
      hostStatus.clear();
      // Do not auto-open the session modal — the user reopens it manually when needed.
    }
  }

  function newDocActive() {
    const s = navigation.selection;
    if (s?.coll) openDocument(s.db, s.coll, null, "insert");
  }

  // Splitter sidebar (kéo ngang)
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

  // Splitter command log (kéo dọc)
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
    canRun={activeQueryTab != null}
    onrun={() => { if (activeQueryTab) getQueryRun(activeQueryTab.id, activeQueryTab.initialStatement).run(sel?.db ?? null); }}
  />
  <div class="body">
    <aside style="width:{shell.sidebarWidth}px">
      <NamespacePanel
        connection={shell.connection}
        onselect={(d) => navigation.selectCollection(d.db, d.coll)}
        onselectdb={(d) => navigation.selectDatabase(d.db)}
        onnewquery={(d) => navigation.openQuery(aggregateTemplate(d.coll))}
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
        workTabs={navigation.workTabs}
        {active}
        onShowContext={(kind) => navigation.showContext(kind)}
        onActivateWork={(id) => navigation.activateWork(id)}
        onCloseWork={(id) => { disposeQueryRun(id); navigation.closeWork(id); }}
        onNewQuery={() => navigation.openQuery(aggregateTemplate(""))}
      />
      <div class="panes">
        {#if navigation.contextTabs.includes("host")}
          <div class="tabpane" hidden={!(active?.zone === "context" && active.kind === "host")}>
            <HostTab connection={shell.connection} />
          </div>
        {/if}
        {#if sel && navigation.contextTabs.includes("database")}
          {@const db = sel.db}
          <div class="tabpane" hidden={!(active?.zone === "context" && active.kind === "database")}>
            {#key db}
              <DatabaseCollectionsPanel {db} onopen={(c) => navigation.selectCollection(db, c)} />
            {/key}
          </div>
        {/if}
        {#if sel?.coll && navigation.contextTabs.includes("collection")}
          {@const db = sel.db}
          {@const coll = sel.coll}
          <div class="tabpane" hidden={!(active?.zone === "context" && active.kind === "collection")}>
            {#key `${db}/${coll}#${navigation.collectionVersion(db, coll)}`}
              <CollectionTab {db} {coll} />
            {/key}
          </div>
        {/if}
        {#if sel?.coll && navigation.contextTabs.includes("data")}
          {@const db = sel.db}
          {@const coll = sel.coll}
          <div class="tabpane" hidden={!(active?.zone === "context" && active.kind === "data")}>
            {#key `${db}/${coll}#${navigation.collectionVersion(db, coll)}`}
              <ResultTable {db} {coll} onopendocument={(doc, mode) => openDocument(db, coll, doc, mode)} />
            {/key}
          </div>
        {/if}
        {#each navigation.workTabs as tab (tab.id)}
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
                  navigation.bumpCollection(tab.db, tab.coll);
                  navigation.closeWork(tab.id);
                }}
                oncancel={() => navigation.closeWork(tab.id)}
              />
            {/if}
          </div>
        {/each}
        {#if active === null}
          <div class="empty">Chọn một database hoặc collection để bắt đầu</div>
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
    dbCount={shell.dbCount}
    collCount={shell.collCount}
    selDb={sel?.db ?? null}
    selColl={sel?.coll ?? null}
    version={hostStatus.info?.version ?? null}
    uptimeSeconds={hostStatus.info?.uptimeSeconds ?? null}
    serverTimeIso={hostStatus.info?.localTimeIso ?? null}
  />
  {#if shell.sessionOpen}
    <SessionManager onconnected={onConnected} onclose={() => shell.toggleSession()} />
  {/if}
  {#if confirmQuit}
    <ConfirmDialog
      title="Thoát LumioNG?"
      message="Bạn có chắc muốn thoát ứng dụng? Công việc chưa lưu sẽ mất."
      confirmLabel="Thoát"
      cancelLabel="Hủy"
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
  .vsplit { width: 5px; flex: none; cursor: col-resize; background: var(--bg); }
  .vsplit:hover { background: var(--hover); }
  section { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  .panes { flex: 1; min-height: 0; position: relative; }
  .tabpane { height: 100%; }
  .tabpane[hidden] { display: none; }
  .empty { padding: 24px; color: var(--muted); font-size: var(--fs); }
  .hsplit { height: 5px; flex: none; cursor: row-resize; background: var(--bg); }
  .hsplit:hover { background: var(--hover); }
</style>
