<script lang="ts">
  import { untrack } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import QueryResultGrid from "./QueryResultGrid.svelte";
  import ResultTree from "./ResultTree.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import type { Doc } from "../domain/doc";
  import * as m from "$lib/paraglide/messages";

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

  /** Keep the store's selection range in sync with the editor (for Run selection). */
  function syncSelection(e: Event) {
    const t = e.currentTarget as HTMLTextAreaElement;
    v.setSelection(t.selectionStart, t.selectionEnd);
  }

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

  <textarea class="editor" bind:value={v.statementText} spellcheck="false" oncontextmenu={openMenu}
    onselect={syncSelection} onkeyup={syncSelection} onmouseup={syncSelection}></textarea>

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
      {#if bottomTab === "result" && v.ran}
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
        {:else if v.ran}
          {#if v.view === "grid"}
            <QueryResultGrid columns={v.columns} docs={v.pageDocs} colWidths={v.colWidths}
              onResize={v.setColWidth} onReset={v.resetColWidth}
              selected={v.selected} menu={v.menu} menuItems={v.menuItems}
              onRowClick={v.clickRow} onOpenMenu={v.openMenu}
              onMenuSelect={onResultMenu} onCloseMenu={v.closeMenu} />
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
      {#if v.ran}
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

{#if v.exportRequest}
  {@const input = v.exportInput()}
  {#if input}<ExportWizard {input} onclose={v.cancelExport} />{/if}
{/if}

<style>
  .query { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 0.625rem; height: 1.875rem; flex: none; background: var(--panel); border-bottom: 1px solid #e2e2e2; padding: 0 0.625rem; }
  .db { color: #777; font-size: 0.75rem; }
  .editor { height: 34%; flex: none; resize: none; border: none; border-bottom: 1px solid #d0d0d0; background: #fffef9; font-family: var(--mono); font-size: 0.8125rem; line-height: 1.6; padding: 0.5rem 0.75rem; box-sizing: border-box; }
  .error { background: #fdecea; color: #b71c1c; padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  .cap { background: #fff8e1; color: #8a6300; padding: 0.375rem 0.625rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.625rem; }
  .cap button { font-size: 0.75rem; cursor: pointer; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 0.125rem; height: 1.625rem; flex: none; background: var(--bg); border-bottom: 1px solid #e0e0e0; padding: 0 0.375rem; }
  .bottom-tabs > button { height: 1.25rem; padding: 0 0.625rem; font-size: 0.75rem; border: 1px solid transparent; background: none; cursor: pointer; color: #666; border-radius: 0.1875rem 0.1875rem 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .view-toggle { margin-left: auto; display: flex; gap: 0.0625rem; }
  .view-toggle button { height: 1.25rem; padding: 0 0.5rem; font-size: 0.6875rem; border: 1px solid #ccc; background: #f0f0f0; color: #444; border-radius: 0.125rem; cursor: pointer; }
  .view-toggle button.active { background: #dcecfa; box-shadow: inset 0 0 0 1px #b9d8f2; color: var(--tab-active-fg); }
  .result-pane { flex: 1; min-height: 0; overflow: hidden; background: var(--panel); }
  .status { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; }
  .pager { display: flex; align-items: center; gap: 0.5rem; flex: none; height: 1.75rem; padding: 0 0.625rem; border-top: 1px solid #e2e2e2; background: #f7f9fb; font-size: 0.75rem; }
  .pager button { height: 1.25rem; padding: 0 0.5rem; border: 1px solid #ccc; background: #f0f0f0; border-radius: 0.125rem; cursor: pointer; color: #444; }
  .pager button:disabled { opacity: 0.45; cursor: default; }
  .pg-info { color: #555; }
  .pg-rows { display: flex; align-items: center; gap: 0.25rem; color: #555; }
  .pg-rows input { width: 3.5rem; height: 1.25rem; text-align: center; }
  .pg-total { margin-left: auto; color: #888; }
</style>
