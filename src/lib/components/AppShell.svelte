<script lang="ts">
  import { detectGridFsBucket } from "#lib/domain/gridfsBucket.js";
  import { isGridfsFilesEmpty } from "#lib/stores/gridfsBucketProbe.svelte.js";
  import { aggregateTemplate } from "#lib/domain/queryStatement.js";
  import { sessionManager } from "#lib/stores/sessionManager.svelte.js";
  import { shell } from "#lib/stores/shell.svelte.js";
  import { activeDataView } from "#lib/stores/activeDataView.svelte.js";
  import { activity } from "#lib/stores/activity.svelte.js";
  import { commandLog } from "#lib/stores/commandLog.svelte.js";
  import type { Doc } from "#lib/domain/doc.js";
  import type { CollectionView, HostSection } from "#lib/stores/navigation.svelte.js";
  import { toolbarFor, type ViewKey } from "#lib/domain/toolbarLayout.js";
  import ViewSwitcher from "#lib/components/ViewSwitcher.svelte";
  import SessionManager from "#lib/components/SessionManager.svelte";
  import WelcomePane from "#lib/components/WelcomePane.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import NamespacePanel from "#lib/components/NamespacePanel.svelte";
  import SavedQueriesPanel from "#lib/components/SavedQueriesPanel.svelte";
  import ResultTable from "#lib/components/ResultTable.svelte";
  import GridFsFilesPanel from "#lib/components/GridFsFilesPanel.svelte";
  import DocumentForm from "#lib/components/DocumentForm.svelte";
  import WatchTab from "#lib/components/WatchTab.svelte";
  import CompareTab from "#lib/components/CompareTab.svelte";
  import TabBar from "#lib/components/TabBar.svelte";
  import { setPendingFilter } from "../stores/pendingFilter";
  import DatabaseCollectionsPanel from "#lib/components/DatabaseCollectionsPanel.svelte";
  import { createAxisDrag } from "#lib/components/axisDrag.js";
  import { lazyComponent } from "#lib/components/lazyComponent.svelte.js";
  import TitleBar from "#lib/components/TitleBar.svelte";
  import MenuBar from "#lib/components/MenuBar.svelte";
  import Toolbar from "#lib/components/Toolbar.svelte";
  import { settings } from "#lib/stores/settings.svelte.js";
  import StatusBar from "#lib/components/StatusBar.svelte";
  import CommandLog from "#lib/components/CommandLog.svelte";
  import { mcp } from "#lib/stores/mcp.svelte.js";
  import { windowFrame } from "#lib/stores/windowFrame.svelte.js";
  import type { Command, CommandId } from "#lib/domain/commands.js";
  import type { AppContext } from "#lib/stores/appContext.svelte.js";
  import type { Snippet } from "svelte";

  let {
    app,
    commands,
    shortcutHint,
    children,
  }: {
    app: AppContext;
    commands: Partial<Record<CommandId, Command>>;
    shortcutHint: (id: CommandId) => string | undefined;
    /** Rendered last inside the shell (the app dialogs). */
    children?: Snippet;
  } = $props();

  const sm = sessionManager;
  const session = $derived(app.session);
  const nav = $derived(app.nav);
  const tree = $derived(app.tree);
  const host = $derived(app.host);
  const active = $derived(app.active);
  const sel = $derived(app.sel);
  const focusEnv = $derived(app.focusEnv);
  const page = $derived(app.page);
  const collectionView = $derived(app.collectionView);
  const onDestination = $derived(app.onDestination);
  const destination = $derived(app.destination);
  const queryActive = $derived(app.queryActive);
  const dataViewActive = $derived(app.dataViewActive);

  // The three heavy tab panes are the only reachers of CodeEditor (QueryTab's editor, HostTab's
  // user/role JSON editors, CollectionTab's index partial-filter/collation editors), so all three
  // must be dynamic for the ~300kB @codemirror stack to stay out of the eager startup chunk —
  // a single static importer anywhere would pull it back in. Same reasoning as CodeEditor's own
  // lazy `js-beautify` import; each pane is already mounted only while it is the active tab.
  const queryTabChunk = lazyComponent(() => import("#lib/components/QueryTab.svelte"));
  const hostTabChunk = lazyComponent(() => import("#lib/components/HostTab.svelte"));
  const collectionTabChunk = lazyComponent(() => import("#lib/components/CollectionTab.svelte"));


  // Shell splitters. The sidebar's dragged edge leads the pointer (sign 1); the two bottom-anchored
  // panels grow as the pointer moves back up the axis (sign -1). Clamping lives in shell's setters.
  const startSavedQueriesDrag = createAxisDrag("y", () => shell.savedQueriesHeight, (px) => shell.setSavedQueriesHeight(px), -1);
  const startSidebarDrag = createAxisDrag("x", () => shell.sidebarWidth, (px) => shell.setSidebarWidth(px));
  const startLogDrag = createAxisDrag("y", () => shell.logHeight, (px) => shell.setLogHeight(px), -1);

  // ── Panel header: which view is showing, its switcher and its actions ──
  const viewKey = $derived.by((): ViewKey | null => {
    if (active?.zone === "work") {
      const kind = sm.workTabs.find((w) => w.id === active.id)?.kind;
      return kind === "query" ? "query" : kind === "watch" ? "watch" : kind === "compare" ? "compare" : "document";
    }
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
    "query.watch": m.menu_watch_changes(),
    "query.save": m.toolbar_save(),
    "grid.focusFilter": m.toolbar_find_title(),
    "view.toggleWrap": m.wrap_toggle_label(),
    "view.toggleSavedQueries": m.toolbar_saved_queries(),
    "view.toggleLog": m.toolbar_command_log(),
    "view.resetLayout": m.cmd_reset_layout(),
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
        run: () => app.showCollectionView(v),
      })),
    ));

  // Header breadcrumb: a document tab names its own namespace; a query tab has its own title row.
  const toolbarCrumb = $derived.by((): string[] => {
    if (active?.zone === "work") {
      const t = sm.workTabs.find((w) => w.id === active.id);
      if (!t || t.kind !== "document") return [];
      return [t.db, t.coll];
    }
    if (page === "host") return [session?.label ?? ""];
    return [sel?.db, sel?.coll].filter((x): x is string => !!x);
  });
</script>

<div class="app">
  <TitleBar
    conn={shell.connection?.label ?? null}
    db={sel?.db ?? null}
    coll={sel?.coll ?? null}
    onquit={() => (app.confirmQuit = true)}
    env={focusEnv}
    nativeFrame={windowFrame.native}
    onpalette={() => (app.paletteOpen = true)}
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
          bind:this={app.namespacePanelRef}
          onselect={(d) => nav?.selectCollection(d.db, d.coll)}
          onselectdb={(d) => nav?.selectDatabase(d.db)}
          onnewquery={(d) => {
            sm.sessions.find((s) => s.id === d.sessionId)?.nav.selectCollection(d.db, d.coll);
            sm.openQuery(aggregateTemplate(d.coll), null, d.sessionId);
          }}
          onmanagesessions={() => shell.openSession()}
          ondisconnect={app.doDisconnect}
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
        <SavedQueriesPanel onopen={app.openSavedQuery} />
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
      {#if viewKey && viewKey !== "query" && viewKey !== "watch" && viewKey !== "compare"}
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
              <DatabaseCollectionsPanel {db} onopen={(c) => nav?.selectCollection(db, c)}
                onopenindexes={(c) => { nav?.selectCollection(db, c); nav?.setCollectionView("indexes"); }}
                onopenfilter={(c, f) => { setPendingFilter(sm.activeId ?? "", db, c, f); nav?.selectCollection(db, c); }} />
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
                <ResultTable {db} {coll} {version} onopendocument={(doc, mode) => app.openDocument(db, coll, doc, mode)} />
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
                  sessionId={tab.sessionId} currentDb={app.dbForSession(tab.sessionId)} active={isActiveTab}
                  onsave={app.saveActiveQuery}
                  onopenhistory={app.openHistoryEntry}
                  onopendocument={(doc: Doc, db: string, coll: string) => app.openDocument(db, coll, doc, "edit")} />
              {:else}
                <div class="empty">{m.status_bar_loading()}</div>
              {/if}
            {:else if tab.kind === "compare"}
              <CompareTab {tab} />
            {:else if tab.kind === "watch"}
              <WatchTab {tab} onopendocument={(db, coll, doc) => app.openDocument(db, coll, doc, "edit")}
                onopenquery={(statement) => sm.openQuery(statement, null, tab.sessionId)} />
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
        {#if active === null && sm.sessions.length === 0}
          <WelcomePane onconnected={app.onConnected} onnewconnection={() => shell.openSession()} />
        {:else if active === null}
          <div class="empty-state">
            <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--c-overlay1)" stroke-width="1.2">
              <ellipse cx="12" cy="5.6" rx="7" ry="3.6" />
              <path d="M5 5.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6M5 12c0 2 3 3.6 7 3.6s7-1.6 7-3.6" />
            </svg>
            <p>{m.page_empty_state()}</p>
            <button class="es-btn" onclick={() => (app.paletteOpen = true)}>
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
    mcpPort={mcp.status === "running" ? mcp.port : null}
    mcpCalls={mcp.calls}
    onmcp={() => (app.mcpOpen = true)}
  />
  {#if shell.sessionOpen}
    <SessionManager onconnected={app.onConnected} onclose={() => shell.toggleSession()} />
  {/if}
  {@render children?.()}
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
