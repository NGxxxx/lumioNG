<script lang="ts">
  import { untrack, tick } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { activeDataView } from "../stores/activeDataView.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import ResultPager from "./ResultPager.svelte";
  import ResultTree from "./ResultTree.svelte";
  import ConsolePane from "./ConsolePane.svelte";
  import ExplainPane from "./ExplainPane.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import { commandLog } from "../stores/commandLog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import DestructiveConfirm from "./DestructiveConfirm.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import * as m from "$lib/paraglide/messages";
  import CodeEditor from "./CodeEditor.svelte";
  import QuerySettingsPopover from "./QuerySettingsPopover.svelte";
  import GridDepthSelect from "./GridDepthSelect.svelte";
  import { settings } from "../stores/settings.svelte";
  import { createPaneResize } from "./paneResize.svelte";
  import { contextAt, needsFields, completeAt } from "../domain/queryComplete";
  import { methodHeadAt } from "../domain/queryStatement";
  import { nextResultView, type ResultViewMode } from "../domain/scriptOutcome";
  import { snippetCompletion, type CompletionSource } from "@codemirror/autocomplete";
  import type { Doc } from "../domain/doc";

  let { id, seq, initialStatement, currentDb, active, onopendocument }:
    { id: number; seq: number; initialStatement: string; currentDb: string | null; active: boolean;
      onopendocument?: (doc: Doc, db: string, coll: string, mode: "edit") => void } = $props();

  const v = untrack(() => getQueryRun(id, sessionManager.active?.id ?? "", initialStatement));
  let bottomTab = $state<"result" | "log">("result");
  let resultView = $state<ResultViewMode>("grid");
  let menu = $state<{ x: number; y: number } | null>(null);
  let editorRef: CodeEditor | undefined;
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
  $effect(() => {
    if (v.explainRequestSeq !== lastExplainRequestSeq) {
      lastExplainRequestSeq = v.explainRequestSeq;
      bottomTab = "result";
      resultView = "explain";
    }
  });

  async function runQuery() {
    bottomTab = "result";
    await v.run(currentDb);
    applyPostRunView();
  }

  async function runSelectionQuery() {
    bottomTab = "result";
    await v.runSelection(currentDb);
    applyPostRunView();
  }

  /** Explain entry point from the editor's own right-click menu — runs the query first if needed, then sets the view directly. */
  async function explainFromMenu() {
    bottomTab = "result";
    if (!v.canExplain) await v.run(currentDb);
    if (v.canExplain) {
      resultView = "explain";
      v.ensureExplain();
    }
  }

  function onMenu(action: string) {
    if (action === "run") runQuery();
    else if (action === "runSelection") runSelectionQuery();
    else if (action === "explain") explainFromMenu();
    else if (action === "cut") editorRef?.cut();
    else if (action === "copy") editorRef?.copy();
    else if (action === "paste") editorRef?.paste();
    else if (action === "clear") editorRef?.clear();
    else if (action === "format") editorRef?.format();
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

  // Bridge for the global toolbar (Edit document / Export / Delete). Registered once for this
  // tab's whole lifetime (Query tabs stay mounted when hidden); activeDataView.setActiveQueryId
  // (set by the app shell) decides which registered tab the toolbar actually defers to.
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
      if (resultView !== "grid") resultView = "grid";
      await tick();
      searchInputEl?.focus();
    },
    get logOpen() { return bottomTab === "log"; },
    toggleLog() { bottomTab = bottomTab === "log" ? "result" : "log"; },
  };
  $effect(() => {
    activeDataView.registerQuery(id, dataViewHandle);
    return () => activeDataView.unregisterQuery(id);
  });
</script>

<div class="query">
  <div class="bar">
    <span class="title"><b>{m.query_tab_title({ seq })}</b></span>
    {#if currentDb}<span class="db">{m.query_tab_db_label({ db: currentDb })}</span>{/if}
    {#if sessionManager.active?.readOnly}
      <span class="readonly-badge" title={m.session_manager_readonly_enable()}>{m.query_tab_readonly()}</span>
    {/if}
    <div class="bar-spacer"></div>
    <QuerySettingsPopover />
  </div>

  <div
    class="editor"
    role="none"
    oncontextmenu={openMenu}
    bind:this={editorEl}
    style={settings.queryEditorHeightPx !== null ? `height:${settings.queryEditorHeightPx}px` : undefined}
  >
    <CodeEditor
      bind:this={editorRef}
      value={v.statementText}
      onChange={(t) => (v.statementText = t)}
      onSelectionChange={v.setSelection}
      onRun={runQuery}
      complete={completionSource} />
  </div>

  <div
    class="pane-divider"
    role="presentation"
    onmousedown={(e) => editorEl && bottomEl && paneResize.start(e, editorEl, bottomEl)}
    ondblclick={() => settings.resetQueryEditorHeight()}
  ></div>

  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.capped}
    <div class="cap">{m.query_tab_capped_notice({ cap: settings.queryResultCap })}</div>
  {/if}

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
          error={v.explainError}
          suggestion={v.indexSuggestion}
          coll={v.provenance?.coll ?? ""}
          oncreateindex={() => v.createSuggestedIndex()}
          onrefresh={() => v.runExplain()}
        />
      </div>
    {:else}
      <div class="result-pane">
        {#if showDocs && resultView === "tree"}
          <ResultTree bind:this={treeRef} docs={v.docs} onRowMenu={(e, i, key) => v.openMenu(e, i, key, "tree")} />
        {:else if showDocs}
          <ResultGrid {v} />
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

{#if v.editBlurPending}
  <ConfirmDialog
    title={m.result_table_unsaved_edit_title()}
    message={m.result_table_unsaved_edit_message()}
    confirmLabel={m.common_save()}
    onconfirm={() => v.confirmBlurEdit()}
    oncancel={() => v.discardBlurEdit()} />
{/if}

{#if v.confirmDelete !== null}
  <ConfirmDialog
    title={m.result_table_delete_selection_title()}
    message={m.result_table_delete_selection_message({ count: v.confirmDelete.count })}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={() => v.confirmDeleteRun()}
    oncancel={() => v.cancelDelete()} />
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
  .readonly-badge { font-size: 0.6875rem; color: var(--warn-fg); background: var(--warn-bg2); border: 1px solid var(--warn-fg); border-radius: 0.1875rem; padding: 0 0.375rem; line-height: 1.4; }
  .db { color: var(--gray-77); font-size: 0.75rem; }
  .bar-spacer { flex: 1; }
  .editor { height: 34%; flex: none; box-sizing: border-box; overflow: hidden; }
  .pane-divider { flex: none; height: 5px; cursor: row-resize; position: relative; border-bottom: 1px solid var(--gray-cf); }
  .pane-divider:hover { background: var(--tab-active-border); opacity: 0.5; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  .cap { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.625rem; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 0.125rem; height: 1.625rem; flex: none; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0 0.375rem; }
  .bottom-tabs > button { height: 1.25rem; padding: 0 0.625rem; font-size: 0.75rem; border: 1px solid transparent; background: none; cursor: pointer; color: var(--th-fg); border-radius: 0.1875rem 0.1875rem 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .right-tools { margin-left: auto; display: flex; align-items: center; gap: 0.375rem; }
  .view-toggle { display: flex; gap: 0.0625rem; }
  .view-toggle button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .view-toggle button.active { background: var(--hover); box-shadow: inset 0 0 0 1px var(--toggle-on-ring); color: var(--tab-active-fg); }
  .search-input { width: 8rem; height: 1.25rem; background: var(--panel); border: 1px solid var(--gray-c4); border-radius: 0.125rem; padding: 0 0.5rem; font-family: Consolas, monospace; font-size: 0.6875rem; box-sizing: border-box; }
  .search-invalid { border-color: var(--error); color: var(--error); }
  .log-clear { margin-left: auto; height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .log-clear:hover { background: var(--hover); }
  .result-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--panel); }
  .status { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .cancel-btn { font-size: 0.75rem; cursor: pointer; border: none; background: none; color: var(--link); }
  .value-display { height: 100%; overflow: auto; padding: 0.5rem 0.75rem; }
  .value-display pre { margin: 0; font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--fg); white-space: pre-wrap; word-break: break-word; }
</style>
