<script lang="ts">
  import { untrack } from "svelte";
  import { get } from "svelte/store";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { getByPath, type ColumnField } from "../domain/schema";
  import type { Doc } from "../domain/doc";
  import BsonCell from "./BsonCell.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  /**
   * Presentational grid only — right-click opens the context menu via `onOpenMenu`, but the menu
   * itself (like ResultTree's `onRowMenu`) is rendered by the parent so Grid and Tree share one
   * `<ContextMenu>` instance backed by the same store state (see QueryTab.svelte).
   */
  let { columns, docs, colWidths, onResize, onReset,
        selected = new Set<number>(), onRowClick = () => {}, onOpenMenu = () => {},
        editing = null, editText = $bindable(""), editError = null,
        onStartEdit = () => {}, onCommitEdit = () => {}, onCancelEdit = () => {} }: {
    columns: ColumnField[];
    docs: Doc[];
    colWidths: Record<string, number>;
    onResize: (path: string, px: number) => void;
    onReset: (path: string) => void;
    selected?: Set<number>;
    onRowClick?: (row: number, mods: { ctrl: boolean; shift: boolean }) => void;
    onOpenMenu?: (e: MouseEvent, row: number, key: string) => void;
    editing?: { row: number; key: string } | null;
    editText?: string;
    editError?: string | null;
    onStartEdit?: (row: number, key: string) => void;
    onCommitEdit?: () => void;
    onCancelEdit?: () => void;
  } = $props();

  const FALLBACK_W = 160;
  const ROWNUM_W = 42;
  const totalWidth = $derived(
    ROWNUM_W + columns.reduce((s, c) => s + (colWidths[c.path] ?? FALLBACK_W), 0),
  );

  // Rows are virtualized so switching Grid/Tree/Console (or a large result set via the "ALL"
  // cap / Show all) doesn't mount thousands of <tr> at once — see ResultTable.svelte, which uses
  // the same pattern for the same reason.
  const ROW_H = 24; // exact row height (px); MUST match `tbody tr[data-index] { height }` below
  const OVERSCAN = 8;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: untrack(() => docs.length),
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  });

  // Keep count + scroll element in sync as docs change (new run / paging) and once mounted.
  // Uses get() so this effect only depends on docs.length and scrollerEl (not the store itself).
  $effect(() => {
    const count = docs.length;
    const el = scrollerEl;
    get(rowVirtualizer).setOptions({
      count,
      getScrollElement: () => el,
      estimateSize: () => ROW_H,
      overscan: OVERSCAN,
    });
  });

  const virtualItems = $derived($rowVirtualizer.getVirtualItems());
  const totalSize = $derived($rowVirtualizer.getTotalSize());
  const padTop = $derived(virtualItems.length ? virtualItems[0].start : 0);
  const padBottom = $derived(
    virtualItems.length ? totalSize - virtualItems[virtualItems.length - 1].end : 0,
  );

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); onCommitEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
  }

  let resizing = false;
  function startResize(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    const startX = e.clientX;
    const startW = colWidths[path] ?? FALLBACK_W;
    const move = (ev: MouseEvent) => onResize(path, startW + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setTimeout(() => { resizing = false; }, 0);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
</script>

{#if columns.length === 0}
  <div class="empty">{m.query_result_grid_empty()}</div>
{:else}
  <div class="scroller" bind:this={scrollerEl}>
    <table style="width:{totalWidth}px">
      <colgroup>
        <col style="width:{ROWNUM_W}px" />
        {#each columns as c (c.path)}<col style="width:{colWidths[c.path] ?? FALLBACK_W}px" />{/each}
      </colgroup>
      <thead>
        <tr>
          <th class="rownum">#</th>
          {#each columns as c (c.path)}
            <th><span class="colname">{c.path}</span><span
                class="col-resize" role="presentation"
                onmousedown={(e) => startResize(e, c.path)}
                ondblclick={(e) => { e.stopPropagation(); onReset(c.path); }}></span></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if padTop > 0}
          <tr aria-hidden="true"><td colspan={columns.length + 1} style="height:{padTop}px; padding:0; border:0;"></td></tr>
        {/if}
        {#each virtualItems as vi (vi.index)}
          {@const i = vi.index}
          {@const d = docs[i]}
          <tr data-index={vi.index}
            style="background:{selected.has(i) ? 'var(--row-selected)' : (i % 2 === 0 ? 'var(--zebra)' : 'var(--zebra-alt)')}"
            onclick={(e) => onRowClick(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}>
            <td class="rownum">{i + 1}</td>
            {#each columns as c (c.path)}
              {@const val = getByPath(d, c.path)}
              <td class="data-cell" oncontextmenu={(e) => onOpenMenu(e, i, c.path)} ondblclick={() => onStartEdit(i, c.path)}>{#if editing && editing.row === i && editing.key === c.path}<input
                    class="celledit"
                    bind:value={editText}
                    onkeydown={onEditKey}
                    onblur={onCancelEdit}
                    use:focusSelect
                  />{#if editError}<div class="cellerror">{msgKey(editError)}</div>{/if}{:else if val !== undefined}<BsonCell value={val} />{/if}</td>
            {/each}
          </tr>
        {/each}
        {#if padBottom > 0}
          <tr aria-hidden="true"><td colspan={columns.length + 1} style="height:{padBottom}px; padding:0; border:0;"></td></tr>
        {/if}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .scroller { overflow: auto; height: 100%; }
  .empty { padding: 1rem; color: var(--muted); font-size: 0.75rem; }
  table { border-collapse: collapse; table-layout: fixed; font-size: 0.75rem; white-space: nowrap; }
  th { background: linear-gradient(var(--th-grad-top), var(--th-grad-bottom)); border: 1px solid var(--gray-cf); padding: 0.25rem 0.5625rem; font-weight: 600; position: sticky; top: 0; z-index: 2; text-align: left; color: var(--fg); }
  .colname { font-weight: 600; }
  .rownum { width: 2.625rem; text-align: right; color: var(--gray-99); font-size: 0.6875rem; padding: 0.1875rem 0.375rem; }
  /* Fixed data-row height so the virtualizer can trust ROW_H without measuring each row. */
  tbody tr[data-index] { height: 24px; }
  td { border: 1px solid var(--cell-border); padding: 0; height: 1.375rem; overflow: hidden; text-overflow: ellipsis; }
  td.data-cell :global(.cell) { padding: 0 0.5625rem; display: inline-block; height: 1.375rem; line-height: 1.375rem; }
  .col-resize { position: absolute; top: 0; right: 0; width: 0.375rem; height: 100%; cursor: col-resize; user-select: none; }
  .col-resize:hover { background: var(--tab-active-border); opacity: 0.5; }
  .celledit { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 0.75rem; padding: 0.125rem 0.25rem; }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-top: 0.125rem; }
</style>
