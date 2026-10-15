<script lang="ts">
  import { untrack } from "svelte";
  import { createColumnResize, gridRowH } from "./gridInteractions.svelte";
  import { settings } from "../stores/settings.svelte";
  import { createRowVirtualizer } from "./rowVirtualizer.svelte";
  import { getByPath } from "../domain/schema";
  import { statusPill, jsonValueColor, bsonValueKind } from "../domain/theme";
  import { clipboardTextOf } from "../domain/extjson";
  import { previewCell } from "../domain/cellPreview";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { moveCursor, extendTo, toggleAt, jumpTo, type NavState } from "../domain/gridNav";
  import { pinnedFirst, pinnedOffsets } from "../domain/colwidth";
  import ContextMenu from "./ContextMenu.svelte";
  import { toast } from "../stores/toast.svelte";
  import type { GridPageView } from "../domain/gridView";
  import type { Doc } from "../domain/doc";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import * as m from "#lib/paraglide/messages.js";
  import { msgKey } from "#lib/msgkey.js";
  import { activeDataView } from "../stores/activeDataView.svelte";
  import { pushModal } from "#lib/stores/modalStack.js";

  let {
    v,
    onopendocument,
    onpeek,
    onescape,
    peekOpen = false,
    onpeekclose,
    onbackground,
  }: {
    v: GridPageView;
    onopendocument?: (doc: Doc, mode: "insert") => void;
    /** Space / e on the cursor row: open the quick-look drawer (edit = start in edit mode). `row` is the real index. */
    onpeek?: (row: number, edit: boolean) => void;
    /** Esc: returns true when the host consumed it (e.g. closed the drawer); otherwise the grid clears its selection. */
    onescape?: () => boolean;
    /** The quick-look drawer is open: Space closes it (via onpeekclose) instead of re-opening. */
    peekOpen?: boolean;
    onpeekclose?: () => void;
    /** A click on empty grid space (not a row, header or button). */
    onbackground?: () => void;
  } = $props();

  const copyText = createClipboardCopy((msg) => toast.push(msg, "error"));
  const FALLBACK_COL_W = 160;
  const ROWNUM_W = 42;
  const colResize = createColumnResize(
    (path) => v.colWidths[path] ?? FALLBACK_COL_W,
    (path, px) => v.setColWidth(path, px),
  );

  const NO_PINS: ReadonlySet<string> = new Set();
  const pins = $derived(v.pinned ?? NO_PINS);
  // Display order: pinned columns first (sticky), then the rest.
  const cols = $derived(pinnedFirst(v.columnFields, pins));
  const pinLeft = $derived<Record<string, number>>(
    pins.size ? pinnedOffsets(cols.map((c) => c.path), v.colWidths, new Set(pins), ROWNUM_W, FALLBACK_COL_W) : {},
  );
  let headerMenu = $state<{ x: number; y: number; path: string } | null>(null);
  function openHeaderMenu(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    headerMenu = { x: e.type === "contextmenu" ? e.clientX : r.left, y: e.type === "contextmenu" ? e.clientY : r.bottom + 4, path };
  }
  const gridColCount = $derived(v.columnFields.length + 1);
  const gridTotalWidth = $derived(
    ROWNUM_W + v.columnFields.reduce((sum, c) => sum + (v.colWidths[c.path] ?? FALLBACK_COL_W), 0),
  );

  const OVERSCAN = 8;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  /** Number of rows actually rendered — every doc, or only the quick-search matches. */
  const rowCount = $derived(v.visibleIndices ? v.visibleIndices.length : v.docs.length);
  /** Maps a display position to the real index into `v.docs` (identity when unfiltered). */
  const rowAt = (i: number) => (v.visibleIndices ? v.visibleIndices[i] : i);

  const rowVirtualizer = createRowVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: () => rowCount,
    getScrollElement: () => scrollerEl,
    estimateSize: () => gridRowH(),
    overscan: OVERSCAN,
  });

  // Density changes the row height: re-measure so offsets and the scrollbar follow.
  $effect(() => {
    void settings.density;
    untrack(() => $rowVirtualizer.measure());
  });
  const SKELETON_ROWS = 12;
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

  // ── Keyboard cursor: a display position (index into the rendered rows, not into docs) ──
  let cursor = $state<number | null>(null);
  let navAnchor = $state<number | null>(null);
  const cursorRow = $derived(cursor !== null && cursor < rowCount ? rowAt(cursor) : null);

  // Real row → display position, built once per visibleIndices (no per-row indexOf).
  const posOf = $derived.by(() => {
    const vis = v.visibleIndices;
    if (!vis) return null;
    const map = new Map<number, number>();
    vis.forEach((row, pos) => map.set(row, pos));
    return map;
  });
  // A different set of rows (page, filter, sort, re-run, quick search) invalidates the cursor; the
  // store says when via `loadGen` (an inline edit reassigns docs but keeps it).
  const loadGen = $derived(v.loadGen ?? v.docs); // no loadGen (simple hosts) → any new rows
  $effect(() => {
    void loadGen;
    untrack(() => {
      cursor = null;
      navAnchor = null;
    });
  });

  function navState(): NavState {
    const map = posOf;
    const toPos = (row: number) => (map ? (map.get(row) ?? -1) : row);
    const selected = new Set([...v.selected].map(toPos).filter((p) => p >= 0));
    return { cursor, anchor: navAnchor, selected };
  }
  function applyNav(s: NavState) {
    cursor = s.cursor;
    navAnchor = s.anchor;
    v.setSelected?.(new Set([...s.selected].map(rowAt)));
    if (s.cursor !== null) $rowVirtualizer.scrollToIndex(s.cursor, { align: "auto" });
  }
  /** Rows that fit in the viewport, for PageUp / PageDown. */
  const pageRows = () => Math.max(1, Math.floor((scrollerEl?.clientHeight ?? 0) / gridRowH()) - 1);
  const isEditable = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest(".cm-editor") !== null);

  function onRowClick(row: number, pos: number, e: MouseEvent) {
    cursor = pos;
    if (!e.shiftKey) navAnchor = pos;
    v.clickRow(row, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }

  /** Cursor / selection / page / peek keys. Returns true when the key was handled. */
  function onNavKey(e: KeyboardEvent): boolean {
    const n = rowCount;
    const at = cursor ?? -1;
    switch (e.key) {
      case "ArrowDown":
      case "j":
        applyNav(e.shiftKey ? extendTo(navState(), at + 1, n) : moveCursor(navState(), 1, n));
        return true;
      case "ArrowUp":
      case "k":
        applyNav(e.shiftKey ? extendTo(navState(), cursor === null ? n - 1 : at - 1, n) : moveCursor(navState(), -1, n));
        return true;
      case "Home":
        applyNav(jumpTo(navState(), 0, n));
        return true;
      case "End":
        applyNav(jumpTo(navState(), n - 1, n));
        return true;
      case "PageDown":
        applyNav(jumpTo(navState(), Math.max(at, 0) + pageRows(), n));
        return true;
      case "PageUp":
        applyNav(jumpTo(navState(), Math.max(at, 0) - pageRows(), n));
        return true;
      case "x":
        if (n > 0) applyNav(toggleAt(navState(), cursor ?? 0));
        return true;
      case "]":
        v.nextPage();
        return true;
      case "[":
        v.prevPage();
        return true;
      case " ":
        if (peekOpen && onpeekclose) {
          onpeekclose();
          return true;
        }
        if (cursorRow !== null) onpeek?.(cursorRow, false);
        return true;
      case "e":
        if (cursorRow !== null) onpeek?.(cursorRow, e.key === "e");
        return true;
      case "/":
        activeDataView.handle?.focusSearch?.();
        return true;
      case "Escape":
        if (!onescape?.()) {
          v.setSelected?.(new Set());
          navAnchor = null;
        }
        return true;
    }
    return false;
  }

  /** Commits the edit, then (if it succeeded) opens the next row's same-column cell — Excel-style "Enter advances". */
  async function commitAndAdvance(row: number, key: string) {
    await v.commitEdit();
    if (v.editing !== null) return; // commit failed; stay put
    const pos = posOf ? (posOf.get(row) ?? -1) : row;
    if (pos !== -1 && pos + 1 < rowCount) v.startEdit(rowAt(pos + 1), key);
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      v.commitEdit();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const editing = v.editing;
      if (editing) void commitAndAdvance(editing.row, editing.key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      v.cancelEdit();
    }
  }
  function onGridKey(e: KeyboardEvent) {
    if (v.editing?.kind === "inline") return; // let the input's native copy/paste through
    if (isEditable(e.target)) return; // typing in a field inside the grid is never a shortcut
    // A focused button inside the grid (eye, column ▾, copy) handles its own keys.
    if (e.target instanceof HTMLElement && e.target !== scrollerEl && e.target.closest("button")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod && !e.altKey && onNavKey(e)) {
      e.preventDefault();
      return;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      v.selectAll?.();
    } else if (mod && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      v.invertSelection?.();
    } else if (mod && (e.key === "c" || e.key === "C") && v.copySelectedAsJson) {
      e.preventDefault();
      v.copySelectedAsJson();
    } else if (mod && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      activeDataView.handle?.focusSearch?.();
    } else if (!mod && e.key === "F2") {
      e.preventDefault();
      activeDataView.handle?.editSelected();
    } else if (mod && e.key === "Delete") {
      e.preventDefault();
      v.requestDeleteSelected?.();
    } else if (mod && e.key === "Insert") {
      e.preventDefault();
      const dup = v.duplicateSelected?.();
      if (dup) onopendocument?.(dup, "insert");
    } else if (!mod && e.key === "Insert") {
      e.preventDefault();
      const doc = v.newDocument?.();
      if (doc) onopendocument?.(doc, "insert");
    }
  }

  // Registers the modal editor with modalStack so Escape closes it regardless of focus, matching every other dialog.
  $effect(() => {
    if (v.editing?.kind !== "modal") return;
    return pushModal({
      onEscape: () => { if (!v.saving) v.cancelEdit(); },
    });
  });
</script>

<div class="grid-region">
  {#if v.loading && v.docs.length > 0}<div class="progress-bar" role="progressbar" aria-label={m.common_loading()}></div>{/if}
  <div class="scroller" role="grid" tabindex="0" aria-label={m.result_table_aria_grid()} onkeydown={onGridKey} bind:this={scrollerEl}
    onclick={(e) => { if (!(e.target as Element).closest("tr[data-index], thead, button, input, .modal-editor")) onbackground?.(); }}
    style="--grid-row-h: {gridRowH()}px">
    {#if v.columnFields.length === 0}
      <div class="empty">{m.query_result_grid_empty()}</div>
    {:else}
    <table style="width:{gridTotalWidth}px">
      <colgroup>
        <col class="col-rownum" />
        {#each cols as c (c.path)}
          <col style="width:{v.colWidths[c.path] ?? FALLBACK_COL_W}px" />
        {/each}
      </colgroup>
      <thead>
        <tr>
          <th class="th-rownum">#</th>
          {#each cols as c (c.path)}
            <th
              class="th-data"
              class:pinned={c.path in pinLeft}
              style:left={c.path in pinLeft ? `${pinLeft[c.path]}px` : undefined}
              oncontextmenu={v.headerMenuItems ? (e) => openHeaderMenu(e, c.path) : undefined}
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
              >{/if}{#if v.headerMenuItems}<button
                class="col-menu-btn"
                aria-label={m.col_menu_open()}
                onclick={(e) => openHeaderMenu(e, c.path)}
                ><svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4" /></svg></button
              >{/if}<span
                class="col-resize"
                role="presentation"
                onpointerdown={(e) => colResize.start(e, c.path)}
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
          {@const row = rowAt(vi.index)}
          {@const d = v.docs[row]}
          <tr
            data-index={vi.index}
            class:row-selected={v.selected.has(row)}
            class:row-cursor={cursor === vi.index}
            style="background:{v.selected.has(row) ? 'var(--row-selected)' : (row % 2 === 0 ? 'var(--zebra)' : 'var(--zebra-alt)')}"
            onclick={(e) => onRowClick(row, vi.index, e)}
          >
            <!-- Intentionally the doc's position in the unfiltered page, not a 1..N renumbering
                 of search matches — row numbers stay stable references as the filter changes. -->
            <td class="td-rownum">
              <span class="rownum-n">{v.allShown ? row + 1 : (v.currentPage - 1) * v.pageSize + row + 1}</span>
              {#if onpeek}
                <button class="peek-btn" aria-label={m.peek_quick_look()} title={m.peek_quick_look()}
                  onclick={(e) => { e.stopPropagation(); applyNav(jumpTo(navState(), vi.index, rowCount)); onpeek(row, false); }}>
                  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>
                </button>
              {/if}
            </td>
            {#each cols as c}
              {@const k = c.path}
              {@const val = getByPath(d, k)}
              {@const p = previewCell(val)}
              <td class="data-cell" class:num={p.align === "right"} class:pinned={k in pinLeft}
                style:left={k in pinLeft ? `${pinLeft[k]}px` : undefined}
                class:cell-editing-modal={v.editing?.kind === "modal" && v.editing.row === row && v.editing.key === k}
                oncontextmenu={(e) => v.openMenu(e, row, k)} ondblclick={() => v.startEdit(row, k)}>
                {#if v.editing && v.editing.row === row && v.editing.key === k && v.editing.kind === "inline"}
                  <input class="celledit" bind:value={v.editText} disabled={v.saving} onkeydown={onEditKey} onblur={v.onEditBlur} use:focusSelect />
                  {#if v.saving}<span class="cell-spinner" aria-label={m.common_loading()}></span>{/if}
                  {#if v.editError}<div class="cellerror">{msgKey(v.editError)}</div>{/if}
                {:else}
                  {#if k === "status" && typeof val === "string"}
                    {@const pill = statusPill(val)}
                    <span class="pill" style="color:{pill.color}; background:{pill.bg};">{val}</span>
                  {:else}
                    {@const kind = p.kind === "missing" ? null : bsonValueKind(p.kind)}
                    <span class="cell {p.kind}" title={p.title ?? p.text}
                      style={kind && p.kind !== "objectId" ? `color:${jsonValueColor(kind)}` : undefined}>{p.text}</span>
                    {#if p.kind === "objectId"}
                      <button class="cell-copy" aria-label={m.cell_copy()} title={m.cell_copy()}
                        onclick={(e) => { e.stopPropagation(); copyText(clipboardTextOf(val)); }}>
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5" /></svg>
                      </button>
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
        {#if v.loading && v.docs.length === 0}
          {#each { length: SKELETON_ROWS } as _, i (i)}
            <tr class="skeleton-row" aria-hidden="true">
              <td class="td-rownum"></td>
              {#each cols as c (c.path)}<td><span class="skeleton-bar" style="width:{40 + ((i * 7 + c.path.length * 13) % 45)}%"></span></td>{/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
    {/if}
  </div>

</div>

{#if headerMenu && v.headerMenuItems}
  {@const hm = headerMenu}
  <ContextMenu
    x={hm.x}
    y={hm.y}
    items={v.headerMenuItems(hm.path)}
    onselect={(action) => { const path = hm.path; headerMenu = null; void v.onHeaderMenuSelect?.(path, action); }}
    onclose={() => (headerMenu = null)}
  />
{/if}

{#if v.editing?.kind === "modal"}
  <div class="modal-backdrop" use:portal role="presentation" use:backdropClose={() => { if (!v.saving) v.cancelEdit(); }}>
    <div class="modal-editor" role="dialog" aria-modal="true" aria-label={m.grid_edit_value_title()}>
      <header>{m.grid_edit_value_title()}</header>
      {#if v.editTextLoading}
        <div class="modal-loading">{m.common_loading()}</div>
      {:else}
        <textarea class="modal-textarea" bind:value={v.editText} disabled={v.saving} spellcheck="false"></textarea>
      {/if}
      {#if v.editError}<div class="cellerror modal-error">{msgKey(v.editError)}</div>{/if}
      <footer>
        <button onclick={() => v.cancelEdit()} disabled={v.saving}>{m.common_cancel()}</button>
        <button class="primary" onclick={() => v.commitEdit()} disabled={v.saving || v.editTextLoading}>{v.saving ? m.document_form_saving() : m.common_save()}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  /* Copied verbatim from ResultTable.svelte's pre-refactor style block; pager/error/io-ok/status/tree-wrap rules stay there. */
  .grid-region { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Isolates paint context to avoid a WebView2 compositing glitch on the sticky header seam. */
  .scroller { overflow: auto; flex: 1; position: relative; contain: paint; isolation: isolate; }
  .empty { padding: 1rem; color: var(--muted); font-size: var(--fs); }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Loading: skeleton on first load, thin indeterminate bar on reloads ── */
  .grid-region { --skeleton: color-mix(in srgb, var(--c-text) 7%, transparent); }
  .skeleton-bar { display: inline-block; height: 0.5rem; border-radius: 0.25rem; background: var(--skeleton); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  .progress-bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 6; overflow: hidden; }
  .progress-bar::after {
    content: ""; position: absolute; top: 0; bottom: 0; width: 30%; background: var(--accent);
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide { from { left: -30%; } to { left: 100%; } }

  /* ── Table base ── */
  /* separate + zero spacing: collapse + sticky is a known Chromium hairline-gap bug. */
  table { border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: var(--fs); white-space: nowrap; user-select: none; }

  /* ── Header ── */
  th {
    box-sizing: border-box;
    background: var(--panel);
    /* transparent top/left keep the old 1px-per-side geometry; only the dividers are drawn */
    border: 1px solid transparent;
    border-right-color: var(--cell-border);
    border-bottom-color: var(--border);
    height: 2rem;
    padding: 0 0.75rem;
    font-weight: 500;
    position: sticky;
    top: 0;
    z-index: 2;
    cursor: pointer;
    user-select: none;
    color: var(--muted);
    font-size: 0.75rem;
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
    padding: 0 0.5rem;
  }

  /* ── Cells ── */
  td {
    /* border-box: border-collapse is now separate, so border+padding must count toward width. */
    box-sizing: border-box;
    border: 1px solid transparent;
    border-right-color: transparent;
    border-bottom-color: var(--row-divider);
    padding: 0 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .td-rownum {
    text-align: right;
    color: var(--c-overlay1);
    background: var(--panel);
    position: sticky;
    left: 0;
    z-index: 1;
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    font-family: var(--mono);
  }
  /* Fixed data-row height so virtualization can trust ROW_H without measuring. Spacer rows
     (padTop/padBottom) have no data-index, so their explicit pixel heights are unaffected. */
  tbody tr[data-index], .skeleton-row { height: var(--grid-row-h, 28px); }
  tbody tr[data-index]:not(.row-selected):hover td { background: var(--row-hover); }
  .row-selected td { border-bottom-color: color-mix(in srgb, var(--accent) 22%, transparent); }
  .row-selected td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
  .row-cursor td { box-shadow: inset 0 1px 0 color-mix(in srgb, var(--accent) 45%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--accent) 45%, transparent); }
  .row-cursor td:first-child { box-shadow: inset 2px 0 0 var(--accent), inset 0 1px 0 color-mix(in srgb, var(--accent) 45%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--accent) 45%, transparent); }
  .scroller:focus { outline: none; }
  .data-cell { padding: 0; height: calc(var(--grid-row-h, 28px) - 2px); position: relative; }
  /* Inlined BsonCell (no component per cell): base + per-BSON-type modifiers. Scalar colors come
     from the inline style attr; object/array colors come from the type-class rules below. */
  .data-cell .cell {
    padding: 0 0.75rem; display: inline-block; height: calc(var(--grid-row-h, 28px) - 2px); line-height: calc(var(--grid-row-h, 28px) - 2px);
    max-width: 20rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    vertical-align: bottom; font-family: var(--mono); font-size: 0.78125rem;
  }
  .data-cell .cell.string { font-family: var(--font); font-size: var(--fs); }
  .data-cell .cell.null { font-style: italic; color: var(--c-overlay2); }
  .data-cell .cell.missing { color: var(--c-overlay0); }
  .data-cell .cell.objectId { color: var(--c-subtext0); }
  .data-cell.num { text-align: right; }
  /* Row number gives way to the quick-look eye on hover. */
  .peek-btn {
    display: none; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; margin-left: auto; padding: 0;
    border: none; border-radius: var(--radius-sm); background: none; color: var(--muted); cursor: pointer;
  }
  tr:hover .peek-btn, .peek-btn:focus-visible { display: inline-flex; }
  tr:hover .td-rownum:has(.peek-btn) .rownum-n { display: none; }
  .peek-btn:hover { background: var(--menu-hover); color: var(--fg); }
  .data-cell .cell-copy {
    position: absolute; top: 50%; right: 0.25rem; transform: translateY(-50%);
    display: none; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; padding: 0;
    border: 1px solid var(--c-surface1); border-radius: var(--radius-sm); background: var(--popover); color: var(--muted); cursor: pointer;
  }
  .data-cell:hover .cell-copy { display: inline-flex; }
  .data-cell .cell-copy:hover { color: var(--fg); }
  /* Previews: keys and punctuation read dim, so the eye lands on values. */
  .data-cell .cell.object, .data-cell .cell.array { color: var(--c-subtext1); font-size: 0.75rem; }

  /* ── Pill (status column) ── */
  .pill {
    display: inline-block;
    padding: 0.0625rem 0.5rem;
    border-radius: 0.5625rem;
    font-size: 0.6875rem;
    font-weight: 500;
    margin: 0.125rem 0.75rem;
  }

  /* ── Edit cell ── */
  .celledit { width: 100%; box-sizing: border-box; font-family: var(--mono); font-size: var(--fs); padding: 0.125rem 0.25rem; }
  .celledit:disabled { opacity: 0.6; }
  .cell-spinner {
    position: absolute; top: 50%; right: 0.25rem; transform: translateY(-50%);
    width: 0.75rem; height: 0.75rem; border: 2px solid var(--spinner-track); border-top-color: var(--progress);
    border-radius: 50%; animation: spin .7s linear infinite;
  }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-top: 0.125rem; }
  /* Cell being edited via the object/array modal — the input itself lives in the modal, this just marks the source cell. */
  .cell-editing-modal { box-shadow: inset 0 0 0 2px var(--focus-ring); }

  /* ── Object/array modal editor ── */
  .modal-backdrop { position: fixed; inset: 0; z-index: 1000; background: var(--backdrop); display: flex; align-items: center; justify-content: center; overflow-y: auto; }
  .modal-editor { background: var(--popover); border: 1px solid var(--c-surface1); width: 34rem; max-width: 90vw; border-radius: 0.75rem; overflow: hidden; display: flex; flex-direction: column; }
  .modal-editor header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); font-size: 0.8125rem; }
  .modal-textarea {
    height: 18rem; margin: 0.875rem; width: calc(100% - 1.75rem); box-sizing: border-box;
    font-family: var(--mono); font-size: var(--fs); padding: 0.5rem; resize: vertical;
  }
  .modal-textarea:disabled { opacity: 0.6; }
  .modal-loading { height: 18rem; margin: 0.875rem; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 0.8125rem; }
  .modal-error { margin: 0 0.875rem 0.625rem; }
  .modal-editor footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  .modal-editor footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .modal-editor footer button:hover:not(:disabled) { background: var(--bg); }
  .modal-editor footer button:disabled { color: var(--gray-b8); cursor: default; }
  .modal-editor footer .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  .modal-editor footer .primary:hover:not(:disabled) { background: var(--run-hover); }

  /* ── Column header decorations ── */
  .colname { font-weight: 500; color: var(--c-subtext1); }
  .badge { margin-left: 0.375rem; font-size: 0.625rem; color: var(--c-overlay2); background: none; border-radius: var(--radius); padding: 0; font-family: var(--mono); font-weight: 400; }
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
  .col-resize:hover { background: var(--accent); opacity: 0.5; }
  .col-menu-btn {
    position: absolute; top: 50%; right: 0.5rem; transform: translateY(-50%);
    display: none; align-items: center; justify-content: center; width: 1.125rem; height: 1.125rem; padding: 0;
    border: none; border-radius: var(--radius-sm); background: var(--menu-hover); color: var(--muted); cursor: pointer;
  }
  th:hover .col-menu-btn, .col-menu-btn:focus-visible { display: inline-flex; }
  .col-menu-btn:hover { color: var(--fg); }
  /* Pinned columns stay put on horizontal scroll (left offsets from domain/colwidth). */
  th.pinned { z-index: 3; }
  td.pinned { position: sticky; z-index: 1; background: var(--panel); }
  th.pinned, td.pinned { box-shadow: inset -1px 0 0 var(--border); }
</style>
