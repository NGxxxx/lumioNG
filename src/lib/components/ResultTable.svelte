<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { get } from "svelte/store";
  import { createCollectionView } from "../stores/collectionView.svelte";
  import { activeDataView } from "../stores/activeDataView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import type { Doc } from "../domain/doc";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { idJson } from "../domain/docid";
  import { getByPath } from "../domain/schema";
  import BulkDialog from "./BulkDialog.svelte";
  import { isEmptyFilter } from "../domain/bulk";
  import ExportWizard from "./ExportWizard.svelte";
  import { statusPill, jsonValueColor } from "../domain/theme";
  import type { ValueKind } from "../domain/theme";
  import { describeValue } from "../domain/extjson";
  import ResultTree from "./ResultTree.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    db,
    coll,
    onopendocument,
  }: {
    db: string;
    coll: string;
    onopendocument: (doc: Doc | null, mode: "edit" | "insert") => void;
  } = $props();

  const v = untrack(() => createCollectionView(sessionManager.active?.id ?? "", db, coll));
  let openDropdown = $state<"sort" | "fields" | null>(null);

  function toggleDropdown(which: "sort" | "fields") {
    if (which === "fields" && openDropdown !== "fields") v.resetProjectionDraft();
    openDropdown = openDropdown === which ? null : which;
  }
  function closeDropdown() {
    openDropdown = null;
  }

  const FALLBACK_COL_W = 160;
  let resizingCol = $state(false);

  /** Drag the right edge of a column header to resize it. */
  function startColResize(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    resizingCol = true;
    const startX = e.clientX;
    const startW = v.colWidths[path] ?? FALLBACK_COL_W;
    function move(ev: MouseEvent) {
      v.setColWidth(path, startW + (ev.clientX - startX));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // clear after the click event would have fired, so the header sort is suppressed
      setTimeout(() => { resizingCol = false; }, 0);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /** Close dropdown when clicking outside the button/popover group. */
  function clickOutside(node: HTMLElement, onOut: () => void) {
    function handle(e: PointerEvent) {
      if (!node.contains(e.target as Node)) onOut();
    }
    document.addEventListener("pointerdown", handle, true);
    return {
      destroy() {
        document.removeEventListener("pointerdown", handle, true);
      },
    };
  }

  let view = $state<"grid" | "tree">("grid");

  /** Map BsonType → ValueKind for color lookup (same logic as BsonCell). */
  function toValueKind(type: string): ValueKind | null {
    switch (type) {
      case "string": return "string";
      case "int": case "long": case "double": case "decimal": return "number";
      case "bool": return "bool";
      case "objectId": return "objectid";
      case "date": return "date";
      case "null": return "null";
      default: return null;
    }
  }

  const visibleColumns = $derived(v.columnFields.filter((c) => !v.hidden.has(c.path)));

  // === Grid row virtualization ===
  // Rows are single-line and fixed-height (see `tbody tr[data-index]` in CSS), so the virtualizer
  // trusts ROW_H exactly — no per-row measureElement/ResizeObserver. This removes scroll churn and
  // a ResizeObserver per visible row, which matters a lot when scrolling 25k rows.
  const ROW_H = 24; // exact row height (px); MUST match `tbody tr[data-index] { height }`
  const OVERSCAN = 8;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: v.docs.length,
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  });

  // Keep count + scroll element in sync as docs change (paging / filter / sort / show-all / reload)
  // and once the scroller is mounted. Use get() so this effect does not subscribe to the store
  // (which would loop); it depends only on docs.length and scrollerEl.
  $effect(() => {
    const count = v.docs.length;
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
  const gridColCount = $derived(visibleColumns.length + 1); // # (rownum) column + data columns

  // Explicit total table width = sum of all column widths. Required for table-layout:fixed to honor
  // the per-column <col> widths exactly (without it the table fills the container and fixed layout
  // *distributes* the slack across columns → resize is absorbed and columns reflow/jitter on scroll).
  const ROWNUM_COL_W = 42; // keep in sync with .col-rownum
  const gridTotalWidth = $derived(
    ROWNUM_COL_W +
      visibleColumns.reduce((sum, c) => sum + (v.colWidths[c.path] ?? FALLBACK_COL_W), 0),
  );

  /** Field summary: visible / total. */
  const fieldsSummary = $derived(`${visibleColumns.length}/${v.columnFields.length}`);

  /** Sort summary: first field + direction, with "+N" if multiple keys. */
  const sortSummary = $derived.by(() => {
    if (v.sortKeys.length === 0) return "";
    const first = v.sortKeys[0];
    const arrow = first.dir === 1 ? "▲" : "▼";
    const extra = v.sortKeys.length - 1;
    return ` ${first.path}${arrow}${extra > 0 ? ` +${extra}` : ""}`;
  });

  /** Fields not yet in sort (for the "+ Add field" picker). */
  const sortableFields = $derived(
    v.columnFields.filter((c) => !v.sortKeys.some((k) => k.path === c.path)),
  );

  function sortDirOf(path: string): 1 | -1 | null {
    const k = v.sortKeys.find((s) => s.path === path);
    return k ? k.dir : null;
  }
  function sortRankOf(path: string): number | null {
    if (v.sortKeys.length < 2) return null;
    const i = v.sortKeys.findIndex((s) => s.path === path);
    return i === -1 ? null : i + 1;
  }

  function applyFields() {
    v.applyProjection();
    closeDropdown();
  }


  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
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
    if (r && "open" in r) onopendocument(await v.openDoc(r.open), "edit");
    else if (r && "insert" in r) onopendocument(r.insert, "insert");
  }

  function onGridKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      v.selectAll();
    }
  }

  // Bridge for the global toolbar (Edit document / Export). Getters keep the toolbar reactive
  // to selection. Edit targets the single selected row (must have an _id); Export uses the
  // selection if any, else the whole filtered set — both reuse the store's existing flows.
  const dataViewHandle = {
    get canEdit() {
      if (v.selectedCount !== 1) return false;
      const d = v.docs[[...v.selected][0]];
      return d ? idJson(d) !== null : false;
    },
    get canExport() {
      return true;
    },
    async editSelected() {
      if (v.selectedCount !== 1) return;
      const d = v.docs[[...v.selected][0]];
      if (!d || idJson(d) === null) return;
      onopendocument(await v.openDoc(d), "edit");
    },
    exportCurrent() {
      v.requestExport(v.selectedCount > 0 ? "selection" : "filter");
    },
  };

  onMount(() => {
    v.init();
    activeDataView.register(dataViewHandle);
  });
  onDestroy(() => activeDataView.unregister(dataViewHandle));
</script>

<div class="result">
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <!-- Filter bar: find { … } monospace display + Run button -->
  <div class="filterbar">
    <span class="filter-label">find</span>
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
    <button class="btn-run" onclick={v.applyFilter}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16"><path d="M4 3l9 5-9 5z" fill="#fff"/></svg>
      {m.result_table_run()}
    </button>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="dropwrap" use:clickOutside={closeDropdown} onkeydown={(e) => { if (e.key === "Escape") closeDropdown(); }} role="group" tabindex="-1">
      <button class="drop-btn" onclick={() => toggleDropdown("sort")} title={m.result_table_sort_title()}>
        {m.result_table_sort_title()}{sortSummary} ▾
      </button>
      {#if openDropdown === "sort"}
        <div class="dropdown sort-dd">
          {#if v.sortKeys.length === 0}
            <div class="dd-empty">{m.result_table_sort_empty()}</div>
          {:else}
            {#each v.sortKeys as k, i}
              <div class="dd-row">
                <span class="dd-rank">{i + 1}.</span>
                <span class="dd-field">{k.path}</span>
                <button class="dd-ic" title={m.result_table_sort_reverse()} onclick={() => v.toggleSortDirAt(k.path)}>{k.dir === 1 ? "▲" : "▼"}</button>
                <button class="dd-ic" title={m.result_table_sort_move_up()} onclick={() => v.moveSort(k.path, -1)} disabled={i === 0}>↑</button>
                <button class="dd-ic" title={m.result_table_sort_move_down()} onclick={() => v.moveSort(k.path, 1)} disabled={i === v.sortKeys.length - 1}>↓</button>
                <button class="dd-ic dd-x" title={m.result_table_sort_remove()} onclick={() => v.removeSort(k.path)}>×</button>
              </div>
            {/each}
          {/if}
          {#if sortableFields.length > 0}
            <label class="dd-add">{m.result_table_sort_add_field()}
              <select
                onchange={(e) => {
                  const p = e.currentTarget.value;
                  if (p) v.addSort(p);
                  e.currentTarget.value = "";
                }}
              >
                <option value=""></option>
                {#each sortableFields as c}
                  <option value={c.path}>{c.path}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if v.sortKeys.length > 0}
            <button class="dd-clear" onclick={v.clearSort}>{m.result_table_sort_clear_all()}</button>
          {/if}
        </div>
      {/if}
      <button class="drop-btn" onclick={() => toggleDropdown("fields")} title={m.result_table_fields_title()}>
        {m.result_table_fields_title()} {fieldsSummary} ▾
      </button>
      {#if openDropdown === "fields"}
        <div class="dropdown fields-dd">
          <div class="dd-allnone">
            <button onclick={v.showAllFieldsDraft}>{m.result_table_fields_show_all()}</button>
            <button onclick={v.hideAllFieldsDraft}>{m.result_table_fields_hide_all()}</button>
          </div>
          <div class="fields-list">
            {#each v.columnFields as c}
              <label class="chooser-row">
                <input
                  type="checkbox"
                  checked={c.path === "_id" ? true : !v.hiddenDraft.has(c.path)}
                  disabled={c.path === "_id"}
                  onchange={() => v.toggleHiddenDraft(c.path)}
                />
                {c.path}{#if c.path === "_id"}<span class="locked">{m.result_table_fields_locked()}</span>{/if}
              </label>
            {/each}
          </div>
          <button class="chooser-apply" onclick={applyFields}>{m.result_table_fields_apply()}</button>
        </div>
      {/if}
    </div>
    <div class="view-toggle">
      <button
        class="toggle-btn"
        class:toggle-active={view === "grid"}
        onclick={() => { view = "grid"; }}
        title={m.result_table_view_grid()}
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2 6h12M2 9.5h12M6.5 2.5v11" stroke="currentColor" stroke-width="0.9"/></svg>
        {m.result_table_view_grid()}
      </button>
      <button
        class="toggle-btn"
        class:toggle-active={view === "tree"}
        onclick={() => { view = "tree"; }}
        title={m.result_table_view_tree()}
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16"><path d="M6 2.5C4 2.5 4 5 4 6.5S2.5 8 2.5 8 4 8.5 4 10s0 3.5 2 3.5M10 2.5c2 0 2 2.5 2 4s1.5 1.5 1.5 1.5S12 8.5 12 10s0 3.5-2 3.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        {m.result_table_view_tree()}
      </button>
    </div>
  </div>
  {#if v.filterError}<div class="error">{msgKey(v.filterError)}</div>{/if}

  {#if view === "grid"}
  <div class="grid-region">
  <div class="scroller" role="grid" tabindex="0" aria-label={m.result_table_aria_grid()} onkeydown={onGridKey} bind:this={scrollerEl}>
    <table style="width:{gridTotalWidth}px">
      <colgroup>
        <col class="col-rownum" />
        {#each visibleColumns as c (c.path)}
          <col style="width:{v.colWidths[c.path] ?? FALLBACK_COL_W}px" />
        {/each}
      </colgroup>
      <thead>
        <tr>
          <th class="th-rownum">#</th>
          {#each visibleColumns as c}
            <th
              class="th-data"
              title={m.result_table_col_header_tooltip()}
              onclick={(e) => { if (resizingCol) return; v.toggleSort(c.path, e.shiftKey); }}
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
                onmousedown={(e) => startColResize(e, c.path)}
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
            {#each visibleColumns as c}
              {@const k = c.path}
              <td class="data-cell" oncontextmenu={(e) => v.openMenu(e, row, k)} ondblclick={() => v.startEdit(row, k)}>
                {#if v.editing && v.editing.row === row && v.editing.key === k}
                  <input
                    class="celledit"
                    bind:value={v.editText}
                    onkeydown={onEditKey}
                    onblur={v.cancelEdit}
                    use:focusSelect
                  />
                  {#if v.editError}<div class="cellerror">{msgKey(v.editError)}</div>{/if}
                {:else}
                  {@const val = getByPath(d, k)}
                  {#if val !== undefined}
                    {#if k === "status" && typeof val === "string"}
                      {@const pill = statusPill(val)}
                      <span class="pill" style="color:{pill.color}; background:{pill.bg};">{val}</span>
                    {:else}
                      {@const info = describeValue(val)}
                      {@const kind = toValueKind(info.type)}
                      <span class="cell {info.type}" title={info.display}
                        style={kind ? `color:${jsonValueColor(kind)}` : undefined}>{info.display}</span>
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
  </div>
  {#if v.loading}
    <div class="loading-overlay" role="status" aria-live="polite">
      <span class="spinner"></span><span>{m.common_loading()}</span>
    </div>
  {/if}
  </div>
  {:else}
  <!-- Tree view (shared, virtualized component) -->
  <div class="tree-wrap">
    <ResultTree docs={v.docs} startIndex={v.allShown ? 0 : (v.currentPage - 1) * v.pageSize}
      onRowMenu={(e, i) => v.openMenu(e, i, "_id")} />
    {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}
  </div>
  {/if}
  {#if v.allShown}
    <div class="pager">
      <button class="pg-btn" onclick={v.firstPage} title={m.result_table_pager_back_to_paged()}>{m.result_table_pager_back_to_paged()}</button>
      <label class="pg-rows">{m.result_table_pager_rows()}
        <input type="number" min="1" value={v.pageSize}
          onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))} />
      </label>
      <span class="pg-total">{m.result_table_pager_all_docs({ count: v.totalCount })}</span>
    </div>
  {:else}
    <div class="pager">
      <button class="pg-btn" onclick={v.firstPage} disabled={v.currentPage <= 1} title={m.result_table_pager_first()}>«</button>
      <button class="pg-btn" onclick={v.prevPage} disabled={v.currentPage <= 1} title={m.result_table_pager_prev()}>‹</button>
      <span class="pg-info">
        <input class="pg-jump" type="number" min="1" max={v.pageCount} value={v.currentPage}
          onchange={(e) => v.goToPage(Math.max(1, +e.currentTarget.value || 1))} />
        / {v.pageCount}
      </span>
      <button class="pg-btn" onclick={v.nextPage} disabled={v.currentPage >= v.pageCount} title={m.result_table_pager_next()}>›</button>
      <button class="pg-btn" onclick={v.lastPage} disabled={v.currentPage >= v.pageCount} title={m.result_table_pager_last()}>»</button>
      <span class="pg-sep">|</span>
      <label class="pg-rows">{m.result_table_pager_rows()}
        <input type="number" min="1" value={v.pageSize}
          onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))} />
      </label>
      <button class="pg-btn" onclick={v.requestShowAll}>{m.result_table_pager_show_all()}</button>
      <span class="pg-total">{m.result_table_pager_docs({ count: v.totalCount })}</span>
    </div>
  {/if}
</div>

{#if v.bulkMode}
  <BulkDialog
    mode={v.bulkMode}
    scope={v.bulkScope}
    appliedFilter={v.appliedFilter}
    isEmpty={isEmptyFilter(v.appliedFilter)}
    selectionCount={v.bulkCount ?? 0}
    bind:updateText={v.bulkUpdateText}
    updateError={v.bulkUpdateError}
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

{#if v.bulkTypeConfirm}
  <DropConfirmDialog
    title={v.bulkMode === "delete" ? m.result_table_bulk_delete_title() : m.result_table_bulk_update_title()}
    message={m.result_table_bulk_confirm_message({ coll })}
    expectedName={coll}
    onconfirm={v.confirmBulkAll}
    oncancel={v.cancelBulkAll}
  />
{/if}

{#if v.confirmDoc}
  <ConfirmDialog
    title={m.result_table_delete_doc_title()}
    message={m.result_table_delete_doc_message()}
    detail={`_id = ${idJson(v.confirmDoc) ?? "(no _id)"}`}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={v.confirmDelete}
    oncancel={v.cancelDelete}
  />
{/if}

{#if v.confirmSelectionDelete !== null}
  <ConfirmDialog
    title={m.result_table_delete_selection_title()}
    message={m.result_table_delete_selection_message({ count: v.confirmSelectionDelete })}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={v.confirmDeleteSelected}
    oncancel={v.cancelDeleteSelected}
  />
{/if}

{#if v.showAllPending !== null}
  <ConfirmDialog
    title={m.result_table_show_all_title()}
    message={m.result_table_show_all_message({ count: v.showAllPending })}
    confirmLabel={m.result_table_show_all_confirm()}
    onconfirm={v.confirmShowAll}
    oncancel={v.cancelShowAll}
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

{#if v.exportRequest}
  {@const input = v.exportInput()}
  {#if input}<ExportWizard {input} onclose={v.cancelExport} />{/if}
{/if}

<style>
  /* ── Layout ── */
  .result { display: flex; flex-direction: column; height: 100%; }
  /* Positioning context for the loading overlay. It must sit OUTSIDE .scroller: an absolute
     child of the scroll container anchors to the content top and scrolls out of view, so the
     spinner would hide above the fold after scrolling down (e.g. on Show all). */
  .grid-region { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .scroller { overflow: auto; flex: 1; position: relative; }

  /* ── Loading overlay (covers the visible grid region, fixed regardless of scroll) ── */
  .loading-overlay {
    position: absolute; inset: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: rgba(255,255,255,.55); color: var(--gray-55); font-size: 0.75rem;
  }
  .spinner { width: 0.875rem; height: 0.875rem; border: 2px solid var(--spinner-track); border-top-color: var(--progress); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Table base ── */
  table { border-collapse: collapse; table-layout: fixed; font-size: 0.75rem; white-space: nowrap; }

  /* ── Header ── */
  th {
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

  /* ── Filter bar ── */
  .filterbar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 1.875rem;
    flex: none;
    background: var(--zebra-alt);
    border-bottom: 1px solid var(--border);
    padding: 0 0.625rem;
  }
  .filter-label { color: var(--gray-77); font-size: 0.75rem; }
  .filter-input {
    flex: 1;
    height: 1.3125rem;
    background: var(--panel);
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    padding: 0 0.5rem;
    font-family: Consolas, monospace;
    font-size: 0.75rem;
    box-sizing: border-box;
  }
  .btn-run {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    height: 1.375rem;
    padding: 0 0.75rem;
    background: var(--run);
    color: var(--panel);
    border: none;
    border-radius: 0.1875rem;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.75rem;
  }
  .btn-run:hover { background: var(--run-hover); }

  /* ── Grid / Tree toggle ── */
  .view-toggle { display: flex; align-items: center; gap: 0.0625rem; margin-left: 0.25rem; }
  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.375rem;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    border: 1px solid var(--gray-c4);
    background: var(--bg);
    cursor: pointer;
    color: var(--gray-44);
    border-radius: 0.125rem;
  }
  .toggle-btn:hover { background: var(--cell-border); }
  .toggle-active {
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--toggle-on-ring);
    color: var(--tab-active-fg);
  }

  /* ── Error / status messages ── */
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .io-ok { background: var(--ok-bg); color: var(--ok-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  /* Tree-view loading hint: overlay so it doesn't disturb the 100%-height virtual scroller. */
  .status { position: absolute; top: 0.375rem; right: 0.75rem; padding: 0.1875rem 0.5rem; color: var(--gray-77); font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.75); border-radius: 0.1875rem; z-index: 5; }

  /* ── Column chooser ── */
  .chooser-row { display: block; font-size: 0.75rem; padding: 0.125rem 0; white-space: nowrap; }
  .chooser-apply {
    display: block;
    margin: 0.5rem 0 0.125rem auto;
    height: 1.375rem;
    padding: 0 0.625rem;
    font-size: 0.75rem;
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    background: var(--bg);
    color: var(--gray-44);
    cursor: pointer;
  }
  .chooser-apply:hover { background: var(--cell-border); }

  /* ── Pager ── */
  .pager {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    height: 1.875rem;
    padding: 0 0.625rem;
    border-top: 1px solid var(--border);
    background: var(--zebra-alt);
    font-size: 0.75rem;
  }
  .pg-btn {
    height: 1.375rem;
    padding: 0 0.5rem;
    border: 1px solid var(--gray-c4);
    background: var(--bg);
    border-radius: 0.125rem;
    cursor: pointer;
    color: var(--gray-44);
  }
  .pg-btn:disabled { opacity: 0.45; cursor: default; }
  .pg-info { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-jump { width: 3.25rem; height: 1.25rem; text-align: center; }
  .pg-total { margin-left: auto; color: var(--muted); }
  .pg-sep { color: var(--gray-c4); }
  .pg-rows { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-rows input { width: 3.5rem; height: 1.25rem; text-align: center; }

  /* ── Tree view ── (rendering lives in the shared, virtualized ResultTree.svelte) */
  .tree-wrap { flex: 1; min-height: 0; position: relative; }
  .tree-wrap > :global(.tree-scroller) { height: 100%; }

  /* ── Header dropdowns (Sort / Fields) ── */
  .dropwrap { position: relative; display: flex; align-items: center; gap: 0.25rem; margin-left: 0.25rem; }
  .dropwrap:focus { outline: none; }
  .drop-btn {
    height: 1.375rem; padding: 0 0.5rem; font-size: 0.75rem;
    border: 1px solid var(--gray-c4); background: var(--bg); color: var(--gray-44);
    border-radius: 0.125rem; cursor: pointer; white-space: nowrap;
  }
  .drop-btn:hover { background: var(--cell-border); }
  .dropdown {
    position: absolute; z-index: 20; top: 100%; left: 0; margin-top: 0.125rem;
    background: var(--panel); border: 1px solid var(--gray-c4); padding: 0.375rem;
    min-width: 11.25rem; max-height: 20rem; overflow: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .dd-allnone { display: flex; gap: 0.375rem; padding-bottom: 0.375rem; margin-bottom: 0.25rem; border-bottom: 1px solid var(--bg); }
  .dd-allnone button { flex: 1; font-size: 0.6875rem; padding: 0.125rem 0; cursor: pointer; }
  .locked { color: var(--gray-aa); font-size: 0.625rem; margin-left: 0.25rem; }
  /* Fields popover: pin Show/Hide-all + Apply, scroll only the field list. */
  .fields-dd { display: flex; flex-direction: column; overflow: hidden; }
  .fields-dd .dd-allnone { flex: none; }
  .fields-list { flex: 1; min-height: 0; overflow: auto; }
  .fields-dd .chooser-apply { flex: none; margin-top: 0.375rem; padding-top: 0.375rem; border-top: 1px solid var(--bg); }

  .dd-empty { color: var(--gray-99); font-size: 0.75rem; padding: 0.125rem 0.125rem 0.375rem; }
  .dd-row { display: flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; padding: 0.125rem 0; white-space: nowrap; }
  .dd-rank { color: var(--gray-99); width: 1rem; }
  .dd-field { flex: 1; font-family: ui-monospace, monospace; }
  .dd-ic {
    width: 1.25rem; height: 1.125rem; border: 1px solid var(--gray-cf); background: var(--th-grad-top);
    border-radius: 0.125rem; cursor: pointer; font-size: 0.6875rem; line-height: 1; padding: 0; color: var(--gray-44);
  }
  .dd-ic:hover { background: var(--tab-inactive-bg); }
  .dd-ic:disabled { opacity: 0.35; cursor: default; }
  .dd-x:hover { background: var(--error-bg); color: var(--error); }
  .dd-add { display: block; font-size: 0.75rem; margin-top: 0.375rem; padding-top: 0.375rem; border-top: 1px solid var(--bg); }
  .dd-add select { margin-left: 0.375rem; font-size: 0.75rem; }
  .dd-clear { margin-top: 0.375rem; width: 100%; font-size: 0.6875rem; cursor: pointer; }

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
