<script lang="ts">
  import { untrack } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import QueryResultGrid from "./QueryResultGrid.svelte";
  import ResultTree from "./ResultTree.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import BsonCell from "./BsonCell.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import type { Doc } from "../domain/doc";
  import * as m from "$lib/paraglide/messages";
  import CodeEditor from "./CodeEditor.svelte";
  import { contextAt, needsFields, completeAt } from "../domain/queryComplete";
  import { methodHeadAt, writeFilterIsEmpty, isDestructiveKind, writeTargetSummary } from "../domain/queryStatement";
  import { snippetCompletion, type CompletionSource } from "@codemirror/autocomplete";

  let { id, seq, initialStatement, currentDb, onopendocument }:
    { id: number; seq: number; initialStatement: string; currentDb: string | null;
      onopendocument?: (db: string, coll: string, doc: Doc, mode: "edit") => void } = $props();

  const v = untrack(() => getQueryRun(id, sessionManager.active?.id ?? "", initialStatement));
  let bottomTab = $state<"result" | "log">("result");
  let menu = $state<{ x: number; y: number } | null>(null);

  // stopPropagation so ContextMenu's just-mounted window listener doesn't immediately close it.
  function openMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY };
  }
  function onMenu(action: string) {
    if (action === "run") v.run(currentDb);
    else if (action === "runSelection") v.runSelection(currentDb);
    menu = null;
  }

  /** Map the pure result into CodeMirror's completion shape (or null). Method completions become
   *  snippets that insert `name()` with the cursor between the parentheses. */
  function toCM(r: { from: number; kind: string; options: { label: string; detail?: string }[] } | null) {
    if (!r) return null;
    const options =
      r.kind === "method"
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

  function onResultMenu(action: string) {
    const r = v.onMenuSelect(action);
    if (r && "open" in r && v.srcDb && v.srcColl) onopendocument?.(v.srcDb, v.srcColl, r.open, "edit");
  }
</script>

<div class="query">
  <div class="bar">
    <span class="title"><b>{m.query_tab_title({ seq })}</b></span>
    {#if currentDb}<span class="db">{m.query_tab_db_label({ db: currentDb })}</span>{/if}
  </div>

  <div class="editor" role="none" oncontextmenu={openMenu}>
    <CodeEditor
      value={v.statementText}
      onChange={(t) => (v.statementText = t)}
      onSelectionChange={v.setSelection}
      onRun={() => v.run(currentDb)}
      complete={completionSource} />
  </div>

  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.capped}
    <div class="cap">{m.query_tab_capped_notice()}
      <button onclick={() => v.runNoLimit(currentDb)}>{m.query_tab_run_no_limit()}</button>
    </div>
  {/if}

  <div class="bottom">
    <div class="bottom-tabs">
      <button class:active={bottomTab === "result"} onclick={() => (bottomTab = "result")}>{m.query_tab_result()}</button>
      <button class:active={bottomTab === "log"} onclick={() => (bottomTab = "log")}>{m.query_tab_command_log()}</button>
      {#if bottomTab === "result" && v.ran && v.resultKind === "docs"}
        <div class="view-toggle">
          <button class:active={v.view === "grid"} onclick={() => (v.view = "grid")}>{m.query_tab_view_grid()}</button>
          <button class:active={v.view === "tree"} onclick={() => (v.view = "tree")}>{m.query_tab_view_tree()}</button>
        </div>
      {/if}
    </div>

    {#if bottomTab === "log"}
      <CommandLogView />
    {:else}
      <div class="result-pane">
        {#if v.loading}
          <div class="status">{m.query_tab_status_running()}</div>
        {:else if v.ran && v.resultKind === "scalar"}
          <div class="scalar">
            <div class="scalar-num">{v.countResult}</div>
            <div class="scalar-label">{m.query_tab_count_result({ count: v.countResult ?? 0 })}</div>
          </div>
        {:else if v.ran && v.resultKind === "values"}
          <div class="values">
            <div class="values-head">
              <span>{m.query_tab_distinct_count({ count: v.distinctValues.length })}</span>
              <button onclick={v.copyValues}>{m.query_tab_copy_all()}</button>
            </div>
            <div class="values-list">
              {#each v.distinctValues as val, i (i)}
                <div class="values-row"><BsonCell value={val} /></div>
              {/each}
            </div>
          </div>
        {:else if v.ran && v.resultKind === "ack"}
          <div class="ack">
            <div class="ack-op">{v.ackResult?.op}</div>
            <dl class="ack-fields">
              {#each v.ackResult?.fields ?? [] as f (f.label)}
                <div class="ack-row"><dt>{f.label}</dt><dd>{f.value}</dd></div>
              {/each}
            </dl>
          </div>
        {:else if v.ran}
          {#if v.view === "grid"}
            <QueryResultGrid columns={v.columns} docs={v.pageDocs} colWidths={v.colWidths}
              onResize={v.setColWidth} onReset={v.resetColWidth}
              selected={v.selected} menu={v.menu} menuItems={v.menuItems}
              onRowClick={v.clickRow} onOpenMenu={v.openMenu}
              onMenuSelect={onResultMenu} onCloseMenu={v.closeMenu}
              editing={v.editing} bind:editText={v.editText} editError={v.editError}
              onStartEdit={v.startEdit} onCommitEdit={v.commitEdit} onCancelEdit={v.cancelEdit} />
          {:else}
            <ResultTree docs={v.pageDocs} onRowMenu={(e, i) => v.openMenu(e, i, "_id")} />
            {#if v.menu}
              <ContextMenu x={v.menu.x} y={v.menu.y} items={v.menuItems()} onselect={onResultMenu} onclose={v.closeMenu} />
            {/if}
          {/if}
        {:else}
          <div class="status">{m.query_tab_status_idle()}</div>
        {/if}
      </div>
      {#if v.ran && v.resultKind === "docs"}
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
          <span class="pg-total">{m.query_tab_docs_count({ count: v.totalCount })}</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y}
    items={[{ label: m.query_tab_menu_run(), action: "run" }, { label: m.query_tab_menu_run_selection(), action: "runSelection", disabled: !v.hasSelection }]}
    onselect={onMenu} onclose={() => (menu = null)} />
{/if}

{#if v.confirmDelete}
  <ConfirmDialog
    title={m.query_tab_confirm_delete_title()}
    message={m.query_tab_confirm_delete_message({ count: v.confirmDelete.count })}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={v.confirmDeleteRun}
    oncancel={v.cancelDelete}
  />
{/if}

{#if v.pendingWrite}
  {@const pw = v.pendingWrite}
  {@const empty = writeFilterIsEmpty(pw.parsed)}
  <ConfirmDialog
    title={m.query_tab_write_confirm_title({ op: pw.parsed.kind })}
    message={empty
      ? m.query_tab_write_empty_filter_warning({ op: pw.parsed.kind, coll: pw.parsed.coll })
      : m.query_tab_write_confirm_message({ op: pw.parsed.kind, coll: pw.parsed.coll })}
    detail={writeTargetSummary(pw.parsed)}
    confirmLabel={m.query_tab_write_run()}
    danger={isDestructiveKind(pw.parsed.kind)}
    onconfirm={v.confirmWrite}
    oncancel={v.cancelWrite}
  />
{/if}

{#if v.exportRequest}
  {@const input = v.exportInput()}
  {#if input}<ExportWizard {input} onclose={v.cancelExport} />{/if}
{/if}

<style>
  .query { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 0.625rem; height: 1.875rem; flex: none; background: var(--panel); border-bottom: 1px solid var(--border); padding: 0 0.625rem; }
  .db { color: var(--gray-77); font-size: 0.75rem; }
  .editor { height: 34%; flex: none; border-bottom: 1px solid var(--gray-cf); box-sizing: border-box; overflow: hidden; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  .cap { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.625rem; }
  .cap button { font-size: 0.75rem; cursor: pointer; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 0.125rem; height: 1.625rem; flex: none; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0 0.375rem; }
  .bottom-tabs > button { height: 1.25rem; padding: 0 0.625rem; font-size: 0.75rem; border: 1px solid transparent; background: none; cursor: pointer; color: var(--th-fg); border-radius: 0.1875rem 0.1875rem 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .view-toggle { margin-left: auto; display: flex; gap: 0.0625rem; }
  .view-toggle button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .view-toggle button.active { background: var(--hover); box-shadow: inset 0 0 0 1px var(--toggle-on-ring); color: var(--tab-active-fg); }
  .result-pane { flex: 1; min-height: 0; overflow: hidden; background: var(--panel); }
  .status { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; }
  .scalar { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem; }
  .scalar-num { font-size: 2.5rem; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
  .scalar-label { font-size: 0.8125rem; color: var(--muted); }
  .values { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .values-head { display: flex; align-items: center; justify-content: space-between; flex: none; height: 1.625rem; padding: 0 0.625rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; color: var(--muted); }
  .values-head button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44); border-radius: 0.125rem; cursor: pointer; }
  .values-list { flex: 1; min-height: 0; overflow: auto; }
  .values-row { height: 1.375rem; line-height: 1.375rem; border-bottom: 1px solid var(--cell-border); font-size: 0.75rem; }
  .values-row :global(.cell) { padding: 0 0.5625rem; display: inline-block; height: 1.375rem; line-height: 1.375rem; }
  .ack { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.625rem; }
  .ack-op { font-size: 0.8125rem; font-weight: 600; color: var(--fg); font-family: ui-monospace, monospace; }
  .ack-fields { display: flex; gap: 1.5rem; margin: 0; }
  .ack-row { display: flex; flex-direction: column; align-items: center; gap: 0.125rem; }
  .ack-row dt { font-size: 0.6875rem; color: var(--muted); }
  .ack-row dd { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
  .pager { display: flex; align-items: center; gap: 0.5rem; flex: none; height: 1.75rem; padding: 0 0.625rem; border-top: 1px solid var(--border); background: var(--zebra-alt); font-size: 0.75rem; }
  .pager button { height: 1.25rem; padding: 0 0.5rem; border: 1px solid var(--gray-c4); background: var(--bg); border-radius: 0.125rem; cursor: pointer; color: var(--gray-44); }
  .pager button:disabled { opacity: 0.45; cursor: default; }
  .pg-info { color: var(--gray-55); }
  .pg-rows { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-rows input { width: 3.5rem; height: 1.25rem; text-align: center; }
  .pg-total { margin-left: auto; color: var(--muted); }
</style>
