<script lang="ts">
  import { untrack } from "svelte";
  import { getQueryRun } from "../stores/queryRuns.svelte";
  import QueryResultGrid from "./QueryResultGrid.svelte";
  import ResultTree from "./ResultTree.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import type { Doc } from "../domain/columns";

  let { id, seq, initialStatement, currentDb, onopendocument }:
    { id: number; seq: number; initialStatement: string; currentDb: string | null;
      onopendocument?: (db: string, coll: string, doc: Doc, mode: "edit") => void } = $props();

  const v = untrack(() => getQueryRun(id, initialStatement));
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
    <span class="title"><b>Query #{seq}</b></span>
    {#if currentDb}<span class="db">db: {currentDb}</span>{/if}
  </div>

  <textarea class="editor" bind:value={v.statementText} spellcheck="false" oncontextmenu={openMenu}
    onselect={syncSelection} onkeyup={syncSelection} onmouseup={syncSelection}></textarea>

  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.capped}
    <div class="cap">Showing first 200 results.
      <button onclick={() => v.runNoLimit(currentDb)}>Run without limit</button>
    </div>
  {/if}

  <div class="bottom">
    <div class="bottom-tabs">
      <button class:active={bottomTab === "result"} onclick={() => (bottomTab = "result")}>Result</button>
      <button class:active={bottomTab === "log"} onclick={() => (bottomTab = "log")}>Command log</button>
      {#if bottomTab === "result" && v.ran}
        <div class="view-toggle">
          <button class:active={v.view === "grid"} onclick={() => (v.view = "grid")}>Grid</button>
          <button class:active={v.view === "tree"} onclick={() => (v.view = "tree")}>Tree</button>
        </div>
      {/if}
    </div>

    {#if bottomTab === "log"}
      <CommandLogView />
    {:else}
      <div class="result-pane">
        {#if v.loading}
          <div class="status">Running…</div>
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
          <div class="status">Edit the statement and run it (toolbar ▶ or right-click → Run).</div>
        {/if}
      </div>
      {#if v.ran}
        <div class="pager">
          <button onclick={() => v.goToPage(1)} disabled={v.currentPage <= 1}>«</button>
          <button onclick={() => v.goToPage(v.currentPage - 1)} disabled={v.currentPage <= 1}>‹</button>
          <span class="pg-info">{v.currentPage} / {v.pageCount}</span>
          <button onclick={() => v.goToPage(v.currentPage + 1)} disabled={v.currentPage >= v.pageCount}>›</button>
          <button onclick={() => v.goToPage(v.pageCount)} disabled={v.currentPage >= v.pageCount}>»</button>
          <label class="pg-rows">Rows
            <input type="number" min="1" value={v.pageSize}
              onchange={(e) => v.setPageSize(+e.currentTarget.value)} />
          </label>
          <span class="pg-total">{v.totalCount} docs</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y}
    items={[{ label: "Run", action: "run" }, { label: "Run selection", action: "runSelection", disabled: !v.hasSelection }]}
    onselect={onMenu} onclose={() => (menu = null)} />
{/if}

{#if v.confirmDelete}
  <ConfirmDialog
    title="Xóa document đã chọn?"
    message={`Bạn sắp xóa ${v.confirmDelete.count} document. Hành động này không hoàn tác được.`}
    confirmLabel="Delete"
    danger
    onconfirm={v.confirmDeleteRun}
    oncancel={v.cancelDelete}
  />
{/if}

<style>
  .query { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 10px; height: 30px; flex: none; background: var(--panel); border-bottom: 1px solid #e2e2e2; padding: 0 10px; }
  .db { color: #777; font-size: 12px; }
  .editor { height: 34%; flex: none; resize: none; border: none; border-bottom: 1px solid #d0d0d0; background: #fffef9; font-family: var(--mono); font-size: 13px; line-height: 1.6; padding: 8px 12px; box-sizing: border-box; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
  .cap { background: #fff8e1; color: #8a6300; padding: 6px 10px; font-size: 12px; display: flex; align-items: center; gap: 10px; }
  .cap button { font-size: 12px; cursor: pointer; }
  .bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bottom-tabs { display: flex; align-items: center; gap: 2px; height: 26px; flex: none; background: var(--bg); border-bottom: 1px solid #e0e0e0; padding: 0 6px; }
  .bottom-tabs > button { height: 20px; padding: 0 10px; font-size: 12px; border: 1px solid transparent; background: none; cursor: pointer; color: #666; border-radius: 3px 3px 0 0; }
  .bottom-tabs > button.active { background: var(--panel); color: var(--tab-active-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tab-active-border); }
  .view-toggle { margin-left: auto; display: flex; gap: 1px; }
  .view-toggle button { height: 20px; padding: 0 8px; font-size: 11px; border: 1px solid #ccc; background: #f0f0f0; color: #444; border-radius: 2px; cursor: pointer; }
  .view-toggle button.active { background: #dcecfa; box-shadow: inset 0 0 0 1px #b9d8f2; color: var(--tab-active-fg); }
  .result-pane { flex: 1; min-height: 0; overflow: hidden; background: var(--panel); }
  .status { padding: 8px 12px; color: var(--muted); font-size: 12px; }
  .pager { display: flex; align-items: center; gap: 8px; flex: none; height: 28px; padding: 0 10px; border-top: 1px solid #e2e2e2; background: #f7f9fb; font-size: 12px; }
  .pager button { height: 20px; padding: 0 8px; border: 1px solid #ccc; background: #f0f0f0; border-radius: 2px; cursor: pointer; color: #444; }
  .pager button:disabled { opacity: 0.45; cursor: default; }
  .pg-info { color: #555; }
  .pg-rows { display: flex; align-items: center; gap: 4px; color: #555; }
  .pg-rows input { width: 56px; height: 20px; text-align: center; }
  .pg-total { margin-left: auto; color: #888; }
</style>
