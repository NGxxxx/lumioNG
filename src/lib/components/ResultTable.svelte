<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionView } from "../stores/collectionView.svelte";
  import type { Doc } from "../domain/columns";
  import BsonCell from "./BsonCell.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { idJson } from "../domain/docid";
  import { getByPath } from "../domain/schema";
  import BulkDialog from "./BulkDialog.svelte";
  import { isEmptyFilter } from "../domain/bulk";

  let {
    db,
    coll,
    onopendocument,
  }: {
    db: string;
    coll: string;
    onopendocument: (doc: Doc | null, mode: "edit" | "insert") => void;
  } = $props();

  const v = untrack(() => createCollectionView(db, coll));
  let scroller = $state<HTMLDivElement>();
  let chooserOpen = $state(false);

  const visibleColumns = $derived(v.columnFields.filter((c) => !v.hidden.has(c.path)));

  function sortDirOf(path: string): 1 | -1 | null {
    const k = v.sortKeys.find((s) => s.path === path);
    return k ? k.dir : null;
  }
  function sortRankOf(path: string): number | null {
    if (v.sortKeys.length < 2) return null;
    const i = v.sortKeys.findIndex((s) => s.path === path);
    return i === -1 ? null : i + 1;
  }

  function toggleChooser() {
    if (!chooserOpen) v.resetProjectionDraft();
    chooserOpen = !chooserOpen;
  }
  function applyChooser() {
    v.applyProjection();
    chooserOpen = false;
  }

  async function openEdit(d: Doc) {
    onopendocument(await v.openDoc(d), "edit");
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function onScroll() {
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    if (scrollHeight - scrollTop - clientHeight < 300) v.loadMore();
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      v.commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      v.cancelEdit();
    }
  }

  async function onMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r) onopendocument(await v.openDoc(r.open), "edit");
  }

  onMount(() => {
    v.init();
  });
</script>

<div class="result">
  <div class="toolbar">
    <button onclick={() => onopendocument(null, "insert")}>+ New document</button>
    <button onclick={() => v.openBulk("update")}>Update many…</button>
    <button onclick={() => v.openBulk("delete")}>Delete many…</button>
    <button onclick={() => v.exportAs("json")} disabled={v.ioBusy}>Export JSON</button>
    <button onclick={() => v.exportAs("csv")} disabled={v.ioBusy}>Export CSV</button>
    <button onclick={() => v.importDocs()} disabled={v.ioBusy}>Import…</button>
    <label class="pagesize">Rows/page
      <input
        type="number"
        min="1"
        value={v.pageSize}
        onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))}
      />
    </label>
    <div class="chooser-wrap">
      <button onclick={toggleChooser}>Columns…</button>
      {#if chooserOpen}
        <div class="chooser">
          {#each v.columnFields as c}
            <label class="chooser-row">
              <input
                type="checkbox"
                checked={!v.hiddenDraft.has(c.path)}
                onchange={() => v.toggleHiddenDraft(c.path)}
              />
              {c.path}
            </label>
          {/each}
          <button class="chooser-apply" onclick={applyChooser}>Apply</button>
        </div>
      {/if}
    </div>
  </div>
  {#if v.ioMessage}<div class="io-ok">{v.ioMessage}</div>{/if}
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <div class="filterbar">
    <input
      class="filter-input"
      bind:value={v.filterText}
      placeholder={'{ "field": value }'}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          v.applyFilter();
        }
      }}
    />
    <button onclick={v.applyFilter}>Apply</button>
  </div>
  {#if v.filterError}<div class="error">{v.filterError}</div>{/if}
  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <table>
      <thead>
        <tr
          ><th class="actions"></th>{#each visibleColumns as c}<th
            onclick={(e) => v.toggleSort(c.path, e.shiftKey)}
            ><span class="colname">{c.path}</span>{#if sortDirOf(c.path)}<span class="sortarrow"
                >{sortDirOf(c.path) === 1 ? "▲" : "▼"}</span
              >{/if}{#if sortRankOf(c.path)}<span class="sortrank">{sortRankOf(c.path)}</span
              >{/if}{#if c.type}<span class="badge"
                >{c.type}{#if c.mixed}*{/if}</span
              >{/if}{#if c.presence !== undefined && c.presence < 1}<span
                class="presence"
                title={`Hiện diện ${Math.round(c.presence * 100)}% mẫu`}>{Math.round(c.presence * 100)}%</span
              >{/if}</th
          >{/each}</tr
        >
      </thead>
      <tbody>
        {#each v.docs as d, row}
          <tr>
            <td class="actions">
              <button onclick={() => openEdit(d)}>Edit</button>
              <button onclick={() => v.requestDelete(d)}>Delete</button>
            </td>
            {#each visibleColumns as c}
              {@const k = c.path}
              <td oncontextmenu={(e) => v.openMenu(e, row, k)} ondblclick={() => v.startEdit(row, k)}>
                {#if v.editing && v.editing.row === row && v.editing.key === k}
                  <input
                    class="celledit"
                    bind:value={v.editText}
                    onkeydown={onEditKey}
                    onblur={v.cancelEdit}
                    use:focusSelect
                  />
                  {#if v.editError}<div class="cellerror">{v.editError}</div>{/if}
                {:else}
                  {@const val = getByPath(d, k)}
                  {#if val !== undefined}<BsonCell value={val} />{/if}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if v.loading}<div class="status">Đang tải…</div>{/if}
    {#if v.done}<div class="status">— hết —</div>{/if}
  </div>
</div>

{#if v.bulkMode}
  <BulkDialog
    mode={v.bulkMode}
    appliedFilter={v.appliedFilter}
    isEmpty={isEmptyFilter(v.appliedFilter)}
    bind:updateText={v.bulkUpdateText}
    updateError={v.bulkUpdateError}
    bind:confirmAll={v.bulkConfirmAll}
    count={v.bulkCount}
    counting={v.bulkCounting}
    running={v.bulkRunning}
    result={v.bulkResult}
    error={v.bulkError}
    canRun={v.canRunBulk}
    oncount={v.countBulk}
    onrun={v.runBulk}
    onclose={v.closeBulk}
  />
{/if}

{#if v.confirmDoc}
  <ConfirmDialog
    idText={idJson(v.confirmDoc) ?? "(không có _id)"}
    onconfirm={v.confirmDelete}
    oncancel={v.cancelDelete}
  />
{/if}

{#if v.menu}
  <ContextMenu
    x={v.menu.x}
    y={v.menu.y}
    items={v.menuItems()}
    onselect={onMenuSelect}
    onclose={v.closeMenu}
  />
{/if}

<style>
  .result { display: flex; flex-direction: column; height: 100%; }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e0e0e0; padding: 4px 8px; text-align: left; }
  th { position: sticky; top: 0; background: #f5f5f5; cursor: pointer; user-select: none; }
  td.actions, th.actions { white-space: nowrap; }
  td.actions button { font-size: 11px; margin-right: 4px; }
  .celledit { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 13px; padding: 2px 4px; }
  .cellerror { color: #b71c1c; font-size: 11px; margin-top: 2px; }
  .colname { font-weight: 600; }
  .badge { margin-left: 6px; font-size: 10px; color: #555; background: #e8e8e8; border-radius: 3px; padding: 0 4px; font-family: ui-monospace, monospace; }
  .presence { margin-left: 4px; font-size: 10px; color: #999; }
  .filterbar { display: flex; gap: 0.5rem; padding: 0.5rem; }
  .filter-input { flex: 1; font-family: monospace; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .io-ok { background: #e8f5e9; color: #1b5e20; padding: 6px 10px; font-size: 12px; }
  .status { padding: 8px; color: #777; font-size: 12px; }
  .pagesize input { width: 64px; margin-left: 4px; }
  .chooser-wrap { position: relative; }
  .chooser { position: absolute; z-index: 10; top: 100%; right: 0; background: #fff; border: 1px solid #ccc; padding: 6px; min-width: 160px; max-height: 260px; overflow: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .chooser-row { display: block; font-size: 12px; padding: 2px 0; white-space: nowrap; }
  .chooser-apply { margin-top: 6px; width: 100%; }
  .sortarrow { margin-left: 4px; font-size: 10px; color: #1565c0; }
  .sortrank { margin-left: 2px; font-size: 9px; color: #1565c0; vertical-align: super; }
</style>
