<script lang="ts">
  import { tooltip } from "../actions/tooltip";
  import { untrack, tick } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import { getPipelineTree } from "../stores/pipelineTreeRuns.svelte";
  import BuilderPanel from "./builder/BuilderPanel.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { activeDataView } from "../stores/activeDataView.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import DocPeekDrawer from "./DocPeekDrawer.svelte";
  import { docPeekFor } from "../stores/docPeek.svelte";
  import RefMenu from "./RefMenu.svelte";
  import { createRefJump } from "../stores/refJump.svelte";
  import { isProdSession, sessionMeta } from "../stores/sessionEnv";
  import { setPendingFilter } from "../stores/pendingFilter";
  import { filterFromChips } from "../domain/filterChips";
  import { idJson } from "../domain/docid";
  import ResultPager from "./ResultPager.svelte";
  import ResultTree from "./ResultTree.svelte";
  import ConsolePane from "./ConsolePane.svelte";
  import ExplainPane from "./ExplainPane.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import { commandLog } from "../stores/commandLog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import DestructiveConfirm from "./DestructiveConfirm.svelte";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import CodeEditor from "./CodeEditor.svelte";
  import QuerySettingsPopover from "./QuerySettingsPopover.svelte";
  import GridDepthSelect from "./GridDepthSelect.svelte";
  import { settings } from "../stores/settings.svelte";
  import { undo } from "../stores/undo.svelte";
  import { queryHistory } from "../stores/queryHistory.svelte";
  import type { HistoryEntry } from "../domain/queryHistory";
  import QueryHistoryPanel from "./QueryHistoryPanel.svelte";
  import { createPaneResize } from "./paneResize.svelte";
  import { contextAt, needsFields, completeAt } from "../domain/queryComplete";
  import { methodHeadAt } from "../domain/queryStatement";
  import { queryTemplates } from "../domain/queryTemplates";
  import { msgKey } from "#lib/msgkey.js";
  import { nextResultView, type ResultViewMode } from "../domain/scriptOutcome";
  import { snippetCompletion, type CompletionSource } from "@codemirror/autocomplete";
  import type { Doc } from "../domain/doc";

  let { id, seq, initialStatement, sessionId, currentDb, active, onopendocument, onsave, onopenhistory }:
    { id: number; seq: number; initialStatement: string; sessionId: string; currentDb: string | null; active: boolean;
      onopendocument?: (doc: Doc, db: string, coll: string, mode: "edit") => void;
      /** Title-row Save (the page owns save vs. save-as against the query library). */
      onsave?: () => void;
      /** History "Open in new tab" (the page owns tabs and sessions). */
      onopenhistory?: (e: HistoryEntry) => void } = $props();

  // History "Load": replacing a different script asks first.
  let replaceWith = $state<HistoryEntry | null>(null);
  function loadFromHistory(e: HistoryEntry) {
    if (v.statementText.trim() && v.statementText !== e.script) replaceWith = e;
    else v.statementText = e.script;
  }

  const v = untrack(() => getQueryRun(id, sessionId, initialStatement));
  const tree = untrack(() =>
    getPipelineTree(id, sessionId, {
      get: () => v.statementText,
      set: (s) => { v.statementText = s; },
      db: () => currentDb,
      preview: { show: (docs, label) => v.showPreview(docs, label), clear: () => v.clearPreview() },
    }),
  );
  let editorMode = $state<"script" | "tree">("script");
  const isAggregateStatement = $derived(
    methodHeadAt(v.statementText, v.statementText.length)?.method === "aggregate",
  );

  function selectTreeMode() {
    tree.syncFromScript();
    editorMode = "tree";
  }

  // Builder only makes sense for an aggregate() pipeline (it edits a stage list) — if the script
  // is edited into something else (e.g. find()) while Builder is open, fall back to Script rather
  // than leave the tab showing the generic "can't display this script visually" banner.
  $effect(() => {
    if (editorMode === "tree" && !isAggregateStatement) editorMode = "script";
  });
  let bottomTab = $state<"result" | "log">("result");
  let bottomCollapsed = $state(false);
  let resultView = $state<ResultViewMode>("grid");
  let menu = $state<{ x: number; y: number } | null>(null);
  let editorRef: CodeEditor | undefined = $state();
  let treeRef: ResultTree | undefined = $state();
  let editorEl = $state<HTMLDivElement | null>(null);
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let bottomEl = $state<HTMLDivElement | null>(null);
  const paneResize = createPaneResize((px) => settings.setQueryEditorHeightPx(px));

  // stopPropagation so ContextMenu's just-mounted window listener doesn't immediately close it.
  function openMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY };
  }
  /** Re-sync the result view to what the just-finished run produced (Grid/Tree/Console). */
  function applyPostRunView() {
    resultView = nextResultView(resultView, v.displayMode, v.consoleEntries.length > 0);
  }

  /** Global Toolbar's Explain button can't reach `resultView` directly, so it bumps `v.explainRequestSeq`; mirror that into local state here (skipping the initial 0). */
  let lastExplainRequestSeq = untrack(() => v.explainRequestSeq);

  // ── Quick-look drawer over the result grid. Only results with a single source collection
  // (grid-editable) can be edited; anything else (aggregations) is shown read-only.
  const peek = docPeekFor(v, {
    sessionId: () => sessionId,
    db: () => v.provenance?.db ?? currentDb,
    coll: () => (v.displayMode === "grid-editable" ? (v.provenance?.coll ?? null) : null),
    loadFull: (d) => v.fullDocFor(d),
    readOnly: () => sessionManager.active?.readOnly ?? false,
    onSaved: (saved) => v.replaceDoc?.(saved),
  });

  // ── Following ObjectId references from results into the drawer ──
  const collectionsOf = (d: string) => sessionManager.active?.tree?.databases.find((x) => x.name === d)?.collections ?? [];
  const refs = createRefJump({
    sessionId: () => sessionId,
    connId: () => sessionMeta(sessionId).connId,
    collections: collectionsOf,
    peek,
    prod: () => isProdSession(sessionId),
  });
  function onGridRef(path: string, value: unknown, anchor: { x: number; y: number } | null) {
    const db = v.provenance?.db ?? currentDb;
    if (db) void refs.jump({ path, value, db, coll: v.provenance?.coll ?? "" }, anchor);
  }
  function onDrawerRef(path: string, value: unknown, anchor: { x: number; y: number } | null) {
    const db = peek.source?.db ?? v.provenance?.db ?? currentDb;
    if (db) void refs.jump({ path, value, db, coll: peek.source?.coll ?? v.provenance?.coll ?? "" }, anchor);
  }
  function openRefTab(src: { db: string; coll: string }, d: Doc) {
    setPendingFilter(sessionId, src.db, src.coll, filterFromChips([{ field: "_id", op: "eq", values: [JSON.stringify(d._id)] }]));
    const nav = sessionManager.active?.nav;
    nav?.selectCollection(src.db, src.coll);
    nav?.setCollectionView("data");
  }
  function onPeek(row: number, edit: boolean) {
    const d = v.docs[row];
    if (d) void peek.show(d, edit);
  }
  /** A click on empty grid space closes an unpinned drawer with nothing unsaved. */
  function onGridBackground() {
    if (peek.open && !settings.peekPinned && !peek.dirty) peek.close();
  }
  function onGridEscape(): boolean {
    if (!peek.open) return false;
    peek.requestClose();
    return true;
  }
  // An undo elsewhere touched this result's collection (changes from before mount were already loaded).
  let undoSeen = untrack(() => undo.changed?.seq ?? 0);
  $effect(() => {
    const change = undo.changed;
    if (!change || change.seq <= undoSeen) return;
    undoSeen = change.seq;
    untrack(() => {
      v.syncAfterUndo(change);
      peek.refreshIfShowing(change);
    });
  });
  // A re-run or page change replaces the rows: the drawer refreshes, keeps a dirty draft (flagged), or closes.
  $effect(() => {
    const docs = v.docs;
    untrack(() => peek.sync(docs));
  });
  /** The drawer's Delete acts on the document it shows, not on whatever the grid has selected. */
  function deleteShown() {
    const id = peek.doc ? idJson(peek.doc) : null;
    const row = id === null ? -1 : v.docs.findIndex((d) => idJson(d) === id);
    if (row === -1) return;
    v.setSelected(new Set([row]));
    v.requestDeleteSelected?.();
  }
  $effect(() => {
    if (v.explainRequestSeq !== lastExplainRequestSeq) {
      lastExplainRequestSeq = v.explainRequestSeq;
      bottomTab = "result";
      bottomCollapsed = false;
      resultView = "explain";
    }
  });

  async function runQuery() {
    bottomTab = "result";
    bottomCollapsed = false;
    await v.run(currentDb, sessionId);
    applyPostRunView();
  }

  async function runSelectionQuery() {
    bottomTab = "result";
    bottomCollapsed = false;
    await v.runSelection(currentDb, sessionId);
    applyPostRunView();
  }

  /** Explain entry point from the editor's own right-click menu — runs the query first if needed (matching the global toolbar's Explain path), then sets the view directly via the explainRequestSeq effect below. */
  async function explainFromMenu() {
    bottomTab = "result";
    bottomCollapsed = false;
    await v.explainAfterRun(currentDb, sessionId);
  }

  // Templates follow the collection of the last statement in the editor, else a placeholder name.
  const templates = $derived(queryTemplates(methodHeadAt(v.statementText, v.statementText.length)?.coll ?? "collection"));

  function onMenu(action: string) {
    if (action === "run") runQuery();
    else if (action === "runSelection") runSelectionQuery();
    else if (action === "explain") explainFromMenu();
    else if (action === "cut") editorRef?.cut();
    else if (action === "copy") editorRef?.copy();
    else if (action === "paste") editorRef?.paste();
    else if (action === "clear") editorRef?.clear();
    else if (action === "format") editorRef?.format();
    else if (action.startsWith("tpl:")) {
      const t = templates.find((x) => `tpl:${x.id}` === action);
      if (t) editorRef?.insertStatement(t.text);
    }
    menu = null;
  }

  /** Map the pure result into CodeMirror's completion shape (or null). Method completions become
   *  snippets that insert `name()` with the cursor between the parentheses. */
  function toCM(r: { from: number; kind: string; options: { label: string; detail?: string }[] } | null) {
    if (!r) return null;
    const options =
      r.kind === "method" || r.kind === "cursor"
        ? r.options.map((o) => snippetCompletion(o.label + "(${})", { label: o.label, detail: o.detail }))
        : r.options;
    return { from: r.from, options, validFor: /^[\w$.]*$/ };
  }

  const completionSource: CompletionSource = (ctx) => {
    const text = ctx.state.doc.toString();
    const c = contextAt(text, ctx.pos);
    if (c.kind === "none") return null;
    if (!ctx.explicit && c.prefix.length === 0) return null; // cheap exit on plain typing
    const collections =
      sessionManager.active?.tree.databases.find((d) => d.name === currentDb)?.collections ?? [];
    if (needsFields(c.kind) && currentDb) {
      const coll = methodHeadAt(text, ctx.pos)?.coll ?? null;
      if (coll) {
        return v.fieldsFor(currentDb, coll).then((fields) => toCM(completeAt(text, ctx.pos, { collections, fields })));
      }
    }
    return toCM(completeAt(text, ctx.pos, { collections, fields: [] }));
  };

  const showDocs = $derived(
    v.displayMode === "grid-editable" || v.displayMode === "grid-readonly"
  );

  async function onGridMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r && "open" in r && v.provenance && onopendocument) {
      onopendocument(r.open, v.provenance.db, v.provenance.coll, "edit");
    } else if (r && "expandFullDepth" in r) {
      treeRef?.expandFullDepth(r.expandFullDepth);
    }
  }

  // Bridge for the global toolbar (Edit/Export/Delete); registered once for this tab's lifetime, activeDataView.setActiveQueryId decides which tab it defers to.
  const dataViewHandle = {
    get canEdit() { return v.canEditSelected; },
    get canExport() { return v.docs.length > 0; },
    get canDelete() { return v.canDeleteSelected; },
    editSelected() {
      const d = v.getSelectedForEdit();
      if (d && v.provenance && onopendocument) onopendocument(d, v.provenance.db, v.provenance.coll, "edit");
    },
    exportCurrent() { v.requestExportCurrent(); },
    deleteSelected() { v.requestDeleteSelected(); },
    // Search box only renders in the "result" tab's Grid view, so switch there first.
    async focusSearch() {
      bottomTab = "result";
      bottomCollapsed = false;
      if (resultView !== "grid") resultView = "grid";
      await tick();
      searchInputEl?.focus();
    },
    get logOpen() { return !bottomCollapsed; },
    toggleLog() { bottomCollapsed = !bottomCollapsed; },
  };
  $effect(() => {
    activeDataView.registerQuery(id, dataViewHandle);
    return () => activeDataView.unregisterQuery(id);
  });
</script>

<div class="query-wrap">
<div class="query">
  <div class="bar">
    <span class="title"><b>{m.query_tab_title({ seq })}</b></span>
    {#if currentDb}<span class="db">{m.query_tab_db_label({ db: currentDb })}</span>{/if}
    {#if sessionManager.active?.readOnly}
      <span class="readonly-badge" title={m.session_manager_readonly_enable()}>{m.query_tab_readonly()}</span>
    {/if}
    <div class="bar-spacer"></div>
    <div class="run-actions">
      <button class="run-btn" onclick={runQuery} disabled={v.running} aria-label={m.toolbar_run_query()} use:tooltip={m.toolbar_run_query()}>
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9.5 5.5L4 13.5z" /></svg>
        <span>{m.toolbar_run_query()}</span>
      </button>
      <button class="icon-btn" onclick={runSelectionQuery} disabled={v.running || !v.hasSelection} aria-label={m.toolbar_run_selection()} use:tooltip={m.toolbar_run_selection()}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3l6 5-6 5z" /><rect x="11" y="3" width="2" height="10" rx="0.5" /></svg>
      </button>
      <button class="icon-btn" onclick={() => v.cancel()} disabled={!v.running} aria-label={m.toolbar_stop()} use:tooltip={m.toolbar_stop()}>
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
      </button>
      <button class="icon-btn" onclick={explainFromMenu} disabled={v.running} aria-label={m.toolbar_explain()} use:tooltip={m.toolbar_explain()}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M5.5 8.5v-1M7 8.5V6M8.5 8.5V5" /></svg>
      </button>
      <button class="icon-btn" class:on={v.historyOpen} onclick={() => v.toggleHistory()} aria-pressed={v.historyOpen} aria-label={m.cmd_query_history()} use:tooltip={m.cmd_query_history()}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
      </button>
      {#if onsave}
        <button class="icon-btn" onclick={onsave} aria-label={m.toolbar_save()} use:tooltip={m.toolbar_save()}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3 2.5h8l2.5 2.5v8.5h-10.5zM5.5 2.5v3h4.5v-3M5 13.5V9.5h6v4" /></svg>
        </button>
      {/if}
    </div>
    <div class="mode-toggle">
      <button class:active={editorMode === "script"} onclick={() => (editorMode = "script")}>⌨ {m.query_tab_editor_mode_script()}</button>
      {#if isAggregateStatement}
        <button class:active={editorMode === "tree"} onclick={selectTreeMode}>⚒ {m.query_tab_editor_mode_builder()}</button>
      {/if}
    </div>
    <QuerySettingsPopover />
  </div>

  <div
    class="editor"
    class:collapsed={bottomCollapsed}
    role="none"
    oncontextmenu={openMenu}
    bind:this={editorEl}
    style={bottomCollapsed || settings.queryEditorHeightPx === null ? undefined : `height:${settings.queryEditorHeightPx}px`}
  >
    {#if editorMode === "script"}
      <CodeEditor
        bind:this={editorRef}
        value={v.statementText}
        onChange={(t) => (v.statementText = t)}
        onSelectionChange={v.setSelection}
        onRun={runQuery}
        onRunSelection={runSelectionQuery}
        onExplain={explainFromMenu}
        complete={completionSource} />
    {:else}
      <BuilderPanel {tree} onexplain={explainFromMenu} collections={sessionManager.sessions.find((x) => x.id === sessionId)?.tree.databases.find((d) => d.name === currentDb)?.collections ?? []} />
    {/if}
  </div>

  {#if !bottomCollapsed}
    <div
      class="pane-divider"
      role="presentation"
      onpointerdown={(e) => editorEl && bottomEl && paneResize.start(e, editorEl, bottomEl)}
      ondblclick={() => settings.resetQueryEditorHeight()}
    ></div>
  {/if}

  {#if v.error || (resultView === "explain" && v.explainError)}
    <div class="error">{v.error || v.explainError}</div>
  {/if}
  {#if v.capped}
    <div class="cap">{m.query_tab_capped_notice({ cap: settings.queryResultCap })}</div>
  {/if}

  {#if !bottomCollapsed}
  <div class="bottom" bind:this={bottomEl}>
    <div class="bottom-tabs">
      <button class:active={bottomTab === "result"} onclick={() => (bottomTab = "result")}>{m.query_tab_result()}</button>
      <button class:active={bottomTab === "log"} onclick={() => (bottomTab = "log")}>{m.query_tab_command_log()}</button>
      {#if bottomTab === "result"}
        <div class="right-tools">
          {#if showDocs && resultView === "grid"}
            <input
              class="search-input"
              class:search-invalid={v.searchInvalid}
              bind:this={searchInputEl}
              bind:value={v.searchTerm}
              placeholder={m.result_table_search_placeholder()}
              title={m.result_table_search_title()}
              aria-label={m.result_table_search_title()}
            />
            <GridDepthSelect />
          {/if}
          {#if showDocs && resultView === "tree"}
            <button class="log-clear" onclick={() => treeRef?.toggleExpandAll()}>
              {treeRef?.isAllExpanded() ? m.result_tree_collapse_all() : m.result_tree_expand_all()}
            </button>
          {/if}
          <div class="view-toggle">
            <button class:active={resultView === "grid"} onclick={() => (resultView = "grid")}>{m.query_tab_view_grid()}</button>
            <button class:active={resultView === "tree"} onclick={() => (resultView = "tree")}>{m.query_tab_view_tree()}</button>
            <button class:active={resultView === "console"} onclick={() => (resultView = "console")}>{m.query_tab_view_console()}</button>
          </div>
        </div>
      {:else if bottomTab === "log"}
        <button class="log-clear" onclick={() => commandLog.clear()}>{m.command_log_clear()}</button>
      {/if}
    </div>

    {#if bottomTab === "log"}
      <CommandLogView />
    {:else if v.running}
      <div class="result-pane">
        <div class="status">
          {m.query_tab_status_running()}
          <button class="cancel-btn" onclick={() => v.cancel()}>{m.common_cancel()}</button>
        </div>
      </div>
    {:else if resultView === "console"}
      <div class="result-pane">
        <ConsolePane entries={v.consoleEntries} elapsedMs={v.lastElapsedMs} onClear={v.clearConsole} />
      </div>
    {:else if resultView === "explain"}
      <div class="result-pane">
        <ExplainPane
          summary={v.explainSummary}
          prevSummary={v.explainPrevSummary}
          rawJson={v.explainRawJson}
          loading={v.explainLoading}
          suggestion={v.indexSuggestion}
          coll={v.provenance?.coll ?? ""}
          oncreateindex={() => v.createSuggestedIndex()}
          onrefresh={() => v.runExplain()}
          pipeline={isAggregateStatement ? tree.stages.filter((s) => s.enabled !== false) : null}
          onmovematchfirst={isAggregateStatement ? () => { tree.moveMatchFirst(); void v.runExplain(); } : undefined}
          prod={isProdSession(sessionId)}
        />
      </div>
    {:else}
      <div class="result-pane">
        {#if v.staleAfterUndo}<div class="stale-note">{m.query_tab_stale_after_undo()}</div>{/if}
        {#if v.previewLabel}
          <div class="preview-note">
            {m.builder_preview_through({ stage: String(v.previewLabel.stage), of: String(v.previewLabel.of) })}
            <button class="link" onclick={() => tree.select(null)}>{m.builder_preview_back()}</button>
          </div>
        {/if}
        {#if showDocs && resultView === "tree"}
          <ResultTree bind:this={treeRef} docs={v.docs} loading={v.loading} onRowMenu={(e, i, key) => v.openMenu(e, i, key, "tree")} />
        {:else if showDocs}
          <div class="grid-host" class:with-pinned={peek.open && settings.peekPinned}>
            <div class="grid-main"><ResultGrid {v} onpeek={onPeek} onescape={onGridEscape} peekOpen={peek.open} onpeekclose={() => peek.requestClose()} onbackground={onGridBackground} onref={onGridRef} /></div>
            {#if peek.open}
              <DocPeekDrawer
                {peek}
                pinned={settings.peekPinned}
                width={settings.peekWidth}
                selectionCount={v.selected.size}
                onresize={(px) => settings.setPeekWidth(px)}
                onpin={(b) => settings.setPeekPinned(b)}
                onopentab={(d) => { if (v.provenance) onopendocument?.(d, v.provenance.db, v.provenance.coll, "edit"); }}
                canDuplicate={false}
                onduplicate={() => {}}
                ondelete={deleteShown}
                onbulk={(a) => { if (a === "delete") v.requestDeleteSelected?.(); }}
                onref={onDrawerRef}
                onopenreftab={openRefTab}
              />
            {/if}
            <RefMenu jump={refs} collections={collectionsOf} />
          </div>
        {:else if v.displayMode === "ack" && v.ackJson !== null}
          <div class="value-display"><pre>{v.ackJson}</pre></div>
        {:else if v.displayMode === "value" && v.valueJson !== null}
          <div class="value-display"><pre>{v.valueJson}</pre></div>
        {:else}
          <div class="status">{m.query_tab_status_idle()}</div>
        {/if}
      </div>
      {#if showDocs}
        <ResultPager {v} />
      {/if}
    {/if}
  </div>
  {/if}
</div>
{#if v.historyOpen}
  <QueryHistoryPanel
    entries={queryHistory.entries}
    tabId={id}
    onload={loadFromHistory}
    onopen={(e) => onopenhistory?.(e)}
    onclear={() => queryHistory.clear()}
    onclose={() => v.toggleHistory()}
  />
{/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y}
    items={[
      { label: m.query_tab_menu_run(), action: "run" },
      { label: m.query_tab_menu_run_selection(), action: "runSelection", disabled: !v.hasSelection },
      { label: m.query_tab_menu_explain(), action: "explain" },
      { label: m.query_tab_menu_cut(), action: "cut", disabled: !v.hasSelection },
      { label: m.query_tab_menu_copy(), action: "copy", disabled: !v.hasSelection },
      { label: m.query_tab_menu_paste(), action: "paste" },
      { label: m.query_tab_menu_clear(), action: "clear" },
      { label: m.query_tab_menu_format(), action: "format" },
      {
        label: m.query_tab_menu_templates(),
        action: "templates",
        disabled: editorMode !== "script",
        children: templates.map((t) => ({ label: msgKey(`query_template_${t.id}`), action: `tpl:${t.id}` })),
      },
    ]}
    onselect={onMenu} onclose={() => (menu = null)} />
{/if}

<!-- Shared row/cell context menu for both Grid and Tree (they funnel into the same v.menu state). -->
{#if v.menu}
  <ContextMenu x={v.menu.x} y={v.menu.y} items={v.menuItems()} onselect={onGridMenuSelect} onclose={v.closeMenu} />
{/if}

{#if v.destructiveConfirm}
  <DestructiveConfirm
    ops={v.destructiveConfirm.ops}
    prod={v.destructiveConfirm.prod}
    onrun={async () => {
      await v.confirmRun();
      applyPostRunView();
    }}
    oncancel={() => v.cancelConfirm()}
    ondontask={async () => {
      await v.dontAskAgain();
      applyPostRunView();
    }} />
{/if}

{#if v.criticalConfirm}
  <DropConfirmDialog
    title={m.script_critical_confirm_title()}
    message={m.script_critical_confirm_message({ op: v.criticalConfirm.ops.join(", ") })}
    expectedName={v.criticalConfirm.ops[0]}
    onconfirm={async () => {
      await v.confirmCritical();
      applyPostRunView();
    }}
    oncancel={() => v.cancelCritical()}
  />
{/if}

{#if v.pendingSessionSwitch}
  {@const p = v.pendingSessionSwitch}
  <ConfirmDialog
    title={m.query_tab_session_switch_title()}
    message={m.query_tab_session_switch_message({
      from: sessionManager.sessions.find((s) => s.id === p.fromSessionId)?.label ?? p.fromSessionId,
      to: sessionManager.sessions.find((s) => s.id === p.toSessionId)?.label ?? p.toSessionId,
    })}
    confirmLabel={m.query_tab_session_switch_confirm({
      to: sessionManager.sessions.find((s) => s.id === p.toSessionId)?.label ?? p.toSessionId,
    })}
    onconfirm={async () => {
      await v.confirmSessionSwitch();
      tree.rebindSession(sessionId);
      applyPostRunView();
    }}
    oncancel={() => v.cancelSessionSwitch()} />
{/if}

{#if v.editBlurPending}
  <ConfirmDialog
    title={m.result_table_unsaved_edit_title()}
    message={m.result_table_unsaved_edit_message()}
    confirmLabel={m.common_save()}
    onconfirm={() => v.confirmBlurEdit()}
    oncancel={() => v.discardBlurEdit()} />
{/if}

<DestructiveDialog gate={v.destructive} />

{#if replaceWith}
  {@const e = replaceWith}
  <ConfirmDialog
    title={m.history_replace_title()}
    message={m.history_replace_message()}
    confirmLabel={m.history_replace()}
    onconfirm={() => { v.statementText = e.script; replaceWith = null; }}
    oncancel={() => (replaceWith = null)} />
{/if}

{#if v.showAllPending !== null}
  <ConfirmDialog
    title={m.result_table_show_all_title()}
    message={m.result_table_show_all_message({ count: v.showAllPending })}
    confirmLabel={m.result_table_show_all_confirm()}
    onconfirm={() => v.confirmShowAll()}
    oncancel={() => v.cancelShowAll()} />
{/if}

{#if v.exportRequest}
  {@const input = v.exportInput()}
  {#if input}<ExportWizard {input} onclose={() => v.cancelExport()} />{/if}
{/if}

{#if v.ioError}<div class="error">{v.ioError}</div>{/if}

<style>
  .query { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 0.625rem; height: 1.875rem; flex: none; background: var(--panel); border-bottom: 1px solid var(--border); padding: 0 0.625rem; }
  .readonly-badge { font-size: 0.6875rem; color: var(--warn-fg); background: var(--warn-bg2); border: 1px solid var(--warn-fg); border-radius: var(--radius); padding: 0 0.375rem; line-height: 1.4; }
  .db { color: var(--gray-77); font-size: var(--fs); }
  .bar-spacer { flex: 1; }
  .editor { height: 34%; flex: none; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; }
  .editor.collapsed { height: auto; flex: 1; }
  .pane-divider { flex: none; height: 5px; cursor: row-resize; position: relative; border-bottom: 1px solid var(--gray-cf); }
  .pane-divider:hover { background: var(--tab-active-border); opacity: 0.5; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); }
  .cap { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.375rem 0.625rem; font-size: var(--fs); display: flex; align-items: center; gap: 0.625rem; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 0.125rem; height: 1.625rem; flex: none; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0 0.375rem; }
  .bottom-tabs > button { height: 1.25rem; padding: 0 0.625rem; font-size: var(--fs); border: 1px solid transparent; background: none; cursor: pointer; color: var(--th-fg); border-radius: 0.1875rem 0.1875rem 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .right-tools { margin-left: auto; display: flex; align-items: center; gap: 0.375rem; }
  .view-toggle, .mode-toggle { display: flex; gap: 0.0625rem; }
  .view-toggle button, .mode-toggle button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: var(--radius-sm); cursor: pointer; }
  .view-toggle button.active, .mode-toggle button.active { background: var(--hover); box-shadow: inset 0 0 0 1px var(--toggle-on-ring); color: var(--tab-active-fg); }
  .search-input { width: 8rem; height: 1.25rem; background: var(--panel); border: 1px solid var(--gray-c4); border-radius: var(--radius-sm); padding: 0 0.5rem; font-family: var(--mono); font-size: 0.6875rem; box-sizing: border-box; }
  .search-invalid { border-color: var(--error); color: var(--error); }
  .log-clear { margin-left: auto; height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: var(--radius-sm); cursor: pointer; }
  .log-clear:hover { background: var(--hover); }
  .result-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--panel); }
  .status { padding: 0.5rem 0.75rem; color: var(--muted); font-size: var(--fs); display: flex; align-items: center; gap: 0.5rem; }
  .cancel-btn { font-size: var(--fs); cursor: pointer; border: none; background: none; color: var(--link); }
  .value-display { height: 100%; box-sizing: border-box; overflow: auto; padding: 0.5rem 0.75rem; }
  .value-display pre { margin: 0; font-family: var(--mono); font-size: var(--fs); color: var(--fg); white-space: pre-wrap; word-break: break-word; }
  .run-actions { display: flex; align-items: center; gap: 0.125rem; margin-right: 0.5rem; }
  .run-btn {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.625rem; margin-right: 0.25rem;
    border: none; border-radius: var(--radius); background: var(--run); color: var(--on-accent);
    font-size: 0.75rem; font-weight: 600; cursor: pointer;
  }
  .run-btn:hover:not(:disabled) { background: var(--run-hover); }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center; width: 1.625rem; height: 1.625rem;
    border: none; border-radius: var(--radius); background: none; color: var(--muted); cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) { background: var(--menu-hover); color: var(--fg); }
  .run-btn:disabled, .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .grid-host { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
  .grid-host.with-pinned { flex-direction: row; }
  .grid-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .stale-note { padding: 0.375rem 0.75rem; background: var(--warn-bg); color: var(--warn-fg); font-size: 0.75rem; border-bottom: 1px solid var(--border); }
  .preview-note { display: flex; align-items: center; gap: 0.75rem; padding: 0.3125rem 0.75rem; background: color-mix(in srgb, var(--accent) 10%, var(--panel)); color: var(--fg); font-size: 0.75rem; border-bottom: 1px solid var(--border); }
  .preview-note .link { border: none; background: none; padding: 0; color: var(--link); font-size: 0.75rem; cursor: pointer; }
  .query-wrap { display: flex; height: 100%; min-height: 0; }
  .query-wrap > .query { flex: 1; min-width: 0; }
</style>
