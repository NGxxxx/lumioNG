<script lang="ts">
  import { untrack } from "svelte";
  import { get } from "svelte/store";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { createColumnResize, GRID_ROW_H } from "./gridInteractions.svelte";
  import { getByPath } from "../domain/schema";
  import { statusPill, jsonValueColor, bsonValueKind } from "../domain/theme";
  import { describeValue, truncateForDisplay } from "../domain/extjson";
  import type { GridPageView } from "../domain/gridView";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let { v }: { v: GridPageView } = $props();

  const FALLBACK_COL_W = 160;
  const ROWNUM_W = 42;
  const colResize = createColumnResize(
    (path) => v.colWidths[path] ?? FALLBACK_COL_W,
    (path, px) => v.setColWidth(path, px),
  );

  const gridColCount = $derived(v.columnFields.length + 1);
  const gridTotalWidth = $derived(
    ROWNUM_W + v.columnFields.reduce((sum, c) => sum + (v.colWidths[c.path] ?? FALLBACK_COL_W), 0),
  );

  const OVERSCAN = 8;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: untrack(() => v.docs.length),
    getScrollElement: () => scrollerEl,
    estimateSize: () => GRID_ROW_H,
    overscan: OVERSCAN,
  });

  $effect(() => {
    const count = v.docs.length;
    const el = scrollerEl;
    get(rowVirtualizer).setOptions({
      count, getScrollElement: () => el, estimateSize: () => GRID_ROW_H, overscan: OVERSCAN,
    });
  });

  const virtualItems = $derived($rowVirtualizer.getVirtualItems());
  const totalSize = $derived($rowVirtualizer.getTotalSize());
  const padTop = $derived(virtualItems.length ? virtualItems[0].start : 0);
  const padBottom = $derived(virtualItems.length ? totalSize - virtualItems[virtualItems.length - 1].end : 0);

  function sortDirOf(path: string): 1 | -1 | null {
    const k = v.sortKeys?.find((s) => s.path === path);
    return k ? k.dir : null;
  }
  function sortRankOf(path: string): number | null {
    if (!v.sortKeys || v.sortKeys.length < 2) return null;
    const i = v.sortKeys.findIndex((s) => s.path === path);
    return i === -1 ? null : i + 1;
  }

  function focusSelect(node: HTMLInputElement) { node.focus(); node.select(); }
  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); v.commitEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); v.cancelEdit(); }
  }
  function onGridKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      v.selectAll?.();
    }
  }
</script>

<div class="grid-region">
  <div class="scroller" role="grid" tabindex="0" aria-label={m.result_table_aria_grid()} onkeydown={onGridKey} bind:this={scrollerEl}>
    {#if v.columnFields.length === 0}
      <div class="empty">{m.query_result_grid_empty()}</div>
    {:else}
    <table style="width:{gridTotalWidth}px">
      <colgroup>
        <col class="col-rownum" />
        {#each v.columnFields as c (c.path)}
          <col style="width:{v.colWidths[c.path] ?? FALLBACK_COL_W}px" />
        {/each}
      </colgroup>
      <thead>
        <tr>
          <th class="th-rownum">#</th>
          {#each v.columnFields as c (c.path)}
            <th
              class="th-data"
              title={m.result_table_col_header_tooltip()}
              onclick={(e) => { if (colResize.resizing || !v.toggleSort) return; v.toggleSort(c.path, e.shiftKey); }}
            ><span class="colname">{c.path}</span>{#if sortDirOf(c.path)}<span class="sortarrow"
                >{sortDirOf(c.path) === 1 ? "▲" : "▼"}</span
              >{/if}{#if sortRankOf(c.path)}<span class="sortrank">{sortRankOf(c.path)}</span
              >{/if}{#if c.type}<span class="badge"
                >{c.type}{#if c.mixed}*{/if}</span
              >{/if}{#if c.presence !== undefined && c.presence < 1}<span
                class="presence"
                title={m.result_table_presence_tooltip({ pct: Math.round(c.presence * 100) })}>{Math.round(c.presence * 100)}%</span
              >{/if}<span
                class="col-resize"
                role="presentation"
                onmousedown={(e) => colResize.start(e, c.path)}
                ondblclick={(e) => { e.stopPropagation(); v.resetColWidth(c.path); }}
              ></span></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if padTop > 0}
          <tr aria-hidden="true"><td colspan={gridColCount} style="height:{padTop}px; padding:0; border:0;"></td></tr>
        {/if}
        {#each virtualItems as vi (vi.index)}
          {@const row = vi.index}
          {@const d = v.docs[row]}
          <tr
            data-index={vi.index}
            class:row-selected={v.selected.has(row)}
            style="background:{v.selected.has(row) ? 'var(--row-selected)' : (row % 2 === 0 ? 'var(--zebra)' : 'var(--zebra-alt)')}"
            onclick={(e) => v.clickRow(row, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
          >
            <td class="td-rownum">{v.allShown ? row + 1 : (v.currentPage - 1) * v.pageSize + row + 1}</td>
            {#each v.columnFields as c}
              {@const k = c.path}
              <td class="data-cell" oncontextmenu={(e) => v.openMenu(e, row, k)} ondblclick={() => v.startEdit(row, k)}>
                {#if v.editing && v.editing.row === row && v.editing.key === k}
                  <input class="celledit" bind:value={v.editText} onkeydown={onEditKey} onblur={v.onEditBlur} use:focusSelect />
                  {#if v.editError}<div class="cellerror">{msgKey(v.editError)}</div>{/if}
                {:else}
                  {@const val = getByPath(d, k)}
                  {#if val !== undefined}
                    {#if k === "status" && typeof val === "string"}
                      {@const pill = statusPill(val)}
                      <span class="pill" style="color:{pill.color}; background:{pill.bg};">{val}</span>
                    {:else}
                      {@const info = describeValue(val)}
                      {@const kind = bsonValueKind(info.type)}
                      {@const shown = truncateForDisplay(info.display)}
                      <span class="cell {info.type}" title={shown}
                        style={kind ? `color:${jsonValueColor(kind)}` : undefined}>{shown}</span>
                    {/if}
                  {/if}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
        {#if padBottom > 0}
          <tr aria-hidden="true"><td colspan={gridColCount} style="height:{padBottom}px; padding:0; border:0;"></td></tr>
        {/if}
      </tbody>
    </table>
    {/if}
  </div>
  {#if v.loading}
    <div class="loading-overlay" role="status" aria-live="polite">
      <span class="spinner"></span><span>{m.common_loading()}</span>
    </div>
  {/if}
</div>

<style>
  /* Copied verbatim from ResultTable.svelte's pre-refactor style block, keeping every class
     name unchanged. Excludes the pager, error, io-ok, status and tree-wrap rules; those stay
     with ResultPager.svelte and ResultTable.svelte respectively. */
  .grid-region { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Isolates paint context to avoid a WebView2 compositing glitch on the sticky header seam. */
  .scroller { overflow: auto; flex: 1; position: relative; contain: paint; isolation: isolate; }
  .empty { padding: 1rem; color: var(--muted); font-size: 0.75rem; }

  /* ── Loading overlay (covers the visible grid region, fixed regardless of scroll) ── */
  .loading-overlay {
    position: absolute; inset: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: color-mix(in srgb, var(--panel) 65%, transparent); color: var(--gray-55); font-size: 0.75rem;
  }
  .spinner { width: 0.875rem; height: 0.875rem; border: 2px solid var(--spinner-track); border-top-color: var(--progress); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Table base ── */
  /* separate + zero spacing: collapse + sticky is a known Chromium hairline-gap bug. */
  table { border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 0.75rem; white-space: nowrap; user-select: none; }

  /* ── Header ── */
  th {
    box-sizing: border-box;
    background: linear-gradient(var(--th-grad-top), var(--th-grad-bottom));
    border: 1px solid var(--gray-cf);
    padding: 0.25rem 0.5625rem;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 2;
    cursor: pointer;
    user-select: none;
    color: var(--fg);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    will-change: transform;
  }
  .th-rownum {
    width: 2.625rem;
    text-align: right;
    color: var(--muted);
    font-weight: 500;
    position: sticky;
    left: 0;
    top: 0;
    z-index: 3;
    padding: 0.25rem 0.375rem;
  }

  /* ── Cells ── */
  td {
    /* border-box: border-collapse is now separate, so border+padding must count toward width. */
    box-sizing: border-box;
    border: 1px solid var(--cell-border);
    padding: 0.1875rem 0.5625rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .td-rownum {
    text-align: right;
    color: var(--gray-99);
    background: var(--th-grad-top);
    position: sticky;
    left: 0;
    z-index: 1;
    padding: 0.1875rem 0.375rem;
    font-size: 0.6875rem;
  }
  /* Fixed data-row height so virtualization can trust ROW_H without measuring. Spacer rows
     (padTop/padBottom) have no data-index, so their explicit pixel heights are unaffected. */
  tbody tr[data-index] { height: 24px; }
  .row-selected td { box-shadow: inset 0 -1px 0 var(--row-selected-ring), inset 0 1px 0 var(--row-selected-ring); }
  .scroller:focus { outline: none; }
  .data-cell { padding: 0; height: 22px; }
  /* Inlined BsonCell (no component per cell): base + per-BSON-type modifiers. Scalar colors come
     from the inline style attr; object/array colors come from the type-class rules below. */
  .data-cell .cell {
    padding: 0 0.5625rem; display: inline-block; height: 22px; line-height: 22px;
    max-width: 20rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    vertical-align: bottom; font-family: ui-monospace, monospace; font-size: 0.75rem;
  }
  .data-cell .cell.string { font-family: system-ui, sans-serif; }
  .data-cell .cell.null { font-style: italic; }
  .data-cell .cell.object { color: var(--type-object); font-style: italic; font-size: 0.6875rem; }
  .data-cell .cell.array { color: var(--type-array); font-style: italic; font-size: 0.6875rem; }

  /* ── Pill (status column) ── */
  .pill {
    display: inline-block;
    padding: 0.0625rem 0.5rem;
    border-radius: 0.5625rem;
    font-size: 0.6875rem;
    font-weight: 600;
    margin: 0.125rem 0.5625rem;
  }

  /* ── Edit cell ── */
  .celledit { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 0.75rem; padding: 0.125rem 0.25rem; }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-top: 0.125rem; }

  /* ── Column header decorations ── */
  .colname { font-weight: 600; }
  .badge { margin-left: 0.375rem; font-size: 0.625rem; color: var(--gray-55); background: var(--tab-inactive-bg); border-radius: 0.1875rem; padding: 0 0.25rem; font-family: ui-monospace, monospace; }
  .presence { margin-left: 0.25rem; font-size: 0.625rem; color: var(--gray-99); }
  .sortarrow { margin-left: 0.25rem; font-size: 0.625rem; color: var(--link); }
  .sortrank { margin-left: 0.125rem; font-size: 0.5625rem; color: var(--link); vertical-align: super; }

  /* ── Column resize handle ── */
  .col-rownum { width: 2.625rem; }
  /* .col-resize anchors off the base `th { position: sticky }` positioning context. */
  .col-resize {
    position: absolute;
    top: 0;
    right: 0;
    width: 0.375rem;
    height: 100%;
    cursor: col-resize;
    user-select: none;
  }
  .col-resize:hover { background: var(--tab-active-border); opacity: 0.5; }
</style>
