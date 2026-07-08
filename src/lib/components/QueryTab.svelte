<script lang="ts">
  import { untrack } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import QueryResultGrid from "./QueryResultGrid.svelte";
  import ResultTree from "./ResultTree.svelte";
  import ConsolePane from "./ConsolePane.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import { commandLog } from "../stores/commandLog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import DestructiveConfirm from "./DestructiveConfirm.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import * as m from "$lib/paraglide/messages";
  import CodeEditor from "./CodeEditor.svelte";
  import QuerySettingsPopover from "./QuerySettingsPopover.svelte";
  import { settings } from "../stores/settings.svelte";
  import { contextAt, needsFields, completeAt } from "../domain/queryComplete";
  import { methodHeadAt } from "../domain/queryStatement";
  import { nextResultView } from "../domain/scriptOutcome";
  import { snippetCompletion, type CompletionSource } from "@codemirror/autocomplete";
  import type { Doc } from "../domain/doc";

  let { id, seq, initialStatement, currentDb, onopendocument }:
    { id: number; seq: number; initialStatement: string; currentDb: string | null;
      onopendocument?: (doc: Doc, db: string, coll: string, mode: "edit") => void } = $props();

  const v = untrack(() => getQueryRun(id, sessionManager.active?.id ?? "", initialStatement));
  let bottomTab = $state<"result" | "log">("result");
  let resultView = $state<"grid" | "tree" | "console">("grid");
  let menu = $state<{ x: number; y: number } | null>(null);
  let editorRef: CodeEditor | undefined;

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

  function onMenu(action: string) {
    if (action === "run") runQuery();
    else if (action === "runSelection") runSelectionQuery();
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
  const editable = $derived(v.displayMode === "grid-editable");
  const totalCount = $derived(v.docs.length);

  async function onGridMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r && "open" in r && v.provenance && onopendocument) {
      onopendocument(r.open, v.provenance.db, v.provenance.coll, "edit");
    }
  }
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

  <div class="editor" role="none" oncontextmenu={openMenu}>
    <CodeEditor
      bind:this={editorRef}
      value={v.statementText}
      onChange={(t) => (v.statementText = t)}
      onSelectionChange={v.setSelection}
      onRun={runQuery}
      complete={completionSource} />
  </div>

  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.capped}
    <div class="cap">{m.query_tab_capped_notice({ cap: settings.queryResultCap })}</div>
  {/if}

  <div class="bottom">
    <div class="bottom-tabs">
      <button class:active={bottomTab === "result"} onclick={() => (bottomTab = "result")}>{m.query_tab_result()}</button>
      <button class:active={bottomTab === "log"} onclick={() => (bottomTab = "log")}>{m.query_tab_command_log()}</button>
      {#if bottomTab === "result"}
        <div class="view-toggle">
          <button class:active={resultView === "grid"} onclick={() => (resultView = "grid")}>{m.query_tab_view_grid()}</button>
          <button class:active={resultView === "tree"} onclick={() => (resultView = "tree")}>{m.query_tab_view_tree()}</button>
          <button class:active={resultView === "console"} onclick={() => (resultView = "console")}>{m.query_tab_view_console()}</button>
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
    {:else}
      <div class="result-pane">
        {#if showDocs && resultView === "tree"}
          <ResultTree docs={v.pageDocs} onRowMenu={(e, i) => v.openMenu(e, i, "_id")} />
        {:else if showDocs}
          <QueryResultGrid
            columns={v.columns}
            docs={v.pageDocs}
            colWidths={v.colWidths}
            onResize={v.setColWidth}
            onReset={v.resetColWidth}
            selected={v.selected}
            onRowClick={v.clickRow}
            onOpenMenu={v.openMenu}
            editing={editable ? v.editing : null}
            bind:editText={v.editText}
            editError={v.editError}
            onStartEdit={editable ? v.startEdit : () => {}}
            onCommitEdit={v.commitEdit}
            onCancelEdit={v.cancelEdit}
            onEditBlur={v.onEditBlur} />
        {:else if v.displayMode === "ack" && v.ackJson !== null}
          <div class="value-display"><pre>{v.ackJson}</pre></div>
        {:else if v.displayMode === "value" && v.valueJson !== null}
          <div class="value-display"><pre>{v.valueJson}</pre></div>
        {:else}
          <div class="status">{m.query_tab_status_idle()}</div>
        {/if}
      </div>
      {#if showDocs && v.allShown}
        <div class="pager">
          <button onclick={v.backToPaged}>{m.result_table_pager_back_to_paged()}</button>
          <span class="pg-total">{m.query_tab_docs_count({ count: totalCount })}</span>
        </div>
      {:else if showDocs}
        <div class="pager">
          <button onclick={() => v.goToPage(1)} disabled={v.currentPage <= 1}>«</button>
          <button onclick={() => v.goToPage(v.currentPage - 1)} disabled={v.currentPage <= 1}>‹</button>
          <span class="pg-info">{v.currentPage} / {v.pageCount}</span>
          <button onclick={() => v.goToPage(v.currentPage + 1)} disabled={v.currentPage >= v.pageCount}>›</button>
          <button onclick={() => v.goToPage(v.pageCount)} disabled={v.currentPage >= v.pageCount}>»</button>
          <label class="pg-rows">{m.query_tab_rows_label()}
            <input type="number" min="1" value={v.pageSize}
              onchange={(e) => v.setPageSize(+e.currentTarget.value)} />
          </label>
          <button onclick={v.showAll}>{m.result_table_pager_show_all()}</button>
          <span class="pg-total">{m.query_tab_docs_count({ count: totalCount })}</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y}
    items={[
      { label: m.query_tab_menu_run(), action: "run" },
      { label: m.query_tab_menu_run_selection(), action: "runSelection", disabled: !v.hasSelection },
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
  .editor { height: 34%; flex: none; border-bottom: 1px solid var(--gray-cf); box-sizing: border-box; overflow: hidden; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  .cap { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.625rem; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 0.125rem; height: 1.625rem; flex: none; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0 0.375rem; }
  .bottom-tabs > button { height: 1.25rem; padding: 0 0.625rem; font-size: 0.75rem; border: 1px solid transparent; background: none; cursor: pointer; color: var(--th-fg); border-radius: 0.1875rem 0.1875rem 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .view-toggle { margin-left: auto; display: flex; gap: 0.0625rem; }
  .view-toggle button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .view-toggle button.active { background: var(--hover); box-shadow: inset 0 0 0 1px var(--toggle-on-ring); color: var(--tab-active-fg); }
  .log-clear { margin-left: auto; height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .log-clear:hover { background: var(--hover); }
  .result-pane { flex: 1; min-height: 0; overflow: hidden; background: var(--panel); }
  .status { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .cancel-btn { font-size: 0.75rem; cursor: pointer; border: none; background: none; color: var(--link); }
  .value-display { height: 100%; overflow: auto; padding: 0.5rem 0.75rem; }
  .value-display pre { margin: 0; font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--fg); white-space: pre-wrap; word-break: break-word; }
  .pager { display: flex; align-items: center; gap: 0.5rem; flex: none; height: 1.75rem; padding: 0 0.625rem; border-top: 1px solid var(--border); background: var(--zebra-alt); font-size: 0.75rem; }
  .pager button { height: 1.25rem; padding: 0 0.5rem; border: 1px solid var(--gray-c4); background: var(--bg); border-radius: 0.125rem; cursor: pointer; color: var(--gray-44); }
  .pager button:disabled { opacity: 0.45; cursor: default; }
  .pg-info { color: var(--gray-55); }
  .pg-rows { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-rows input { width: 3.5rem; height: 1.25rem; text-align: center; }
  .pg-total { margin-left: auto; color: var(--muted); }
</style>
