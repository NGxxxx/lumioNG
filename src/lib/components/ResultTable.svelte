<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionView } from "../stores/collectionView.svelte";
  import type { Doc } from "../domain/columns";
  import BsonCell from "./BsonCell.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { idJson } from "../domain/docid";
  import { getByPath } from "../domain/schema";

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

  function onMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r) onopendocument(r.open, "edit");
  }

  onMount(() => {
    v.init();
  });
</script>

<div class="result">
  <div class="toolbar">
    <button onclick={() => onopendocument(null, "insert")}>+ New document</button>
  </div>
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
          ><th class="actions"></th>{#each v.columnFields as c}<th
            ><span class="colname">{c.path}</span>{#if c.type}<span class="badge"
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
              <button onclick={() => onopendocument(d, "edit")}>Edit</button>
              <button onclick={() => v.requestDelete(d)}>Delete</button>
            </td>
            {#each v.columnFields as c}
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
  .toolbar { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e0e0e0; padding: 4px 8px; text-align: left; }
  th { position: sticky; top: 0; background: #f5f5f5; }
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
  .status { padding: 8px; color: #777; font-size: 12px; }
</style>
