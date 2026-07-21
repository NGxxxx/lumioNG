<script lang="ts">
  import { untrack } from "svelte";
  import { get } from "svelte/store";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import type { Doc } from "../domain/doc";
  import { flattenDocs, fieldPath, fullDepthPaths, type TreeRow } from "../domain/treeFlatten";
  import { describeValue, truncateForDisplay } from "../domain/extjson";
  import { jsonValueColor, bsonValueKind } from "../domain/theme";
  import { settings } from "../stores/settings.svelte";
  import * as m from "$lib/paraglide/messages";

  /** Shared, virtualized nested tree (collection grid + query results). Rows come pre-flattened
   *  from domain/treeFlatten so every visible row costs the same and 25k+ docs stay smooth. */
  let { docs, startIndex = 0, onRowMenu }: {
    docs: Doc[];
    startIndex?: number;
    onRowMenu?: (e: MouseEvent, docIndex: number, key: string) => void;
  } = $props();

  let open = $state<Set<string>>(new Set());
  const rows = $derived(flattenDocs(docs, open));

  function toggle(path: string) {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    open = next;
  }

  /** Resets scroll so expand/collapse-all isn't stuck showing a now-invalid offset. */
  function scrollToTop() {
    if (scrollerEl) scrollerEl.scrollTop = 0;
    get(rowVirtualizer).scrollToOffset(0);
  }

  /** Open every doc row (depth 1 only — deeper opens are kept). Called by parents via bind:this. */
  export function expandAll() {
    open = new Set([...open, ...docs.map((_, i) => `#${i}`)]);
    scrollToTop();
  }
  export function collapseAll() {
    open = new Set();
    scrollToTop();
  }
  /** True once every doc row (depth 1) is open — drives the Expand/Collapse toggle button label. */
  export function isAllExpanded(): boolean {
    return docs.length > 0 && docs.every((_, i) => open.has(`#${i}`));
  }
  export function toggleExpandAll() {
    if (isAllExpanded()) collapseAll();
    else expandAll();
  }
  /** Expand every nested object/array in one document, at every depth (context-menu action). */
  export function expandFullDepth(docIndex: number) {
    const doc = docs[docIndex];
    if (!doc) return;
    open = new Set([...open, ...fullDepthPaths(doc, docIndex)]);
  }

  // Reset expansion when docs change (paging/sort/filter/new query).
  let lastDocs = untrack(() => docs);
  $effect(() => {
    if (docs !== lastDocs) {
      lastDocs = docs;
      open = new Set();
    }
  });

  function valColor(v: unknown): string {
    const info = describeValue(v);
    const kind = bsonValueKind(info.type);
    if (kind) return `color:${jsonValueColor(kind)}`;
    if (info.type === "object") return "color:var(--j-brace)";
    if (info.type === "array") return "color:var(--type-array)";
    return "color:var(--gray-44)";
  }

  function idFull(doc: Doc): string {
    const id = doc._id;
    return id === undefined || id === null ? "(no _id)" : describeValue(id).display;
  }
  function idPreview(doc: Doc): string {
    const s = idFull(doc);
    return s.length > 32 ? s.slice(0, 31) + "…" : s;
  }
  function fieldsSummary(count: number): string {
    return count === 1 ? m.result_tree_fields_one() : m.result_tree_fields_many({ count });
  }
  function menuKey(row: TreeRow): string {
    return row.depth === 0 ? "_id" : fieldPath(row.path);
  }

  // All rows are one fixed line high (matches `.tree-row { height }` below), so the virtualizer
  // estimate is exact and nothing needs measuring — except when Wrap is on (long strings wrap).
  const ROW_EST = 24;
  const OVERSCAN = 10;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: untrack(() => rows.length),
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_EST,
    overscan: OVERSCAN,
  });

  $effect(() => {
    const count = rows.length;
    const el = scrollerEl;
    get(rowVirtualizer).setOptions({
      count,
      getScrollElement: () => el,
      estimateSize: () => ROW_EST,
      overscan: OVERSCAN,
    });
  });

  const virtualItems = $derived($rowVirtualizer.getVirtualItems());
  const totalSize = $derived($rowVirtualizer.getTotalSize());

  // Rows are fixed-height so measuring returns exactly ROW_EST (no drift, negligible cost);
  // keeping it unconditional means wrap-mode rows (variable height) are measured too, even
  // when the Wrap toggle flips after rows have mounted.
  function measure(node: HTMLDivElement) {
    get(rowVirtualizer).measureElement(node);
    return {};
  }
</script>

{#if docs.length === 0}
  <div class="empty">{m.result_tree_empty()}</div>
{:else}
  <div class="tree-scroller" bind:this={scrollerEl} role="tree">
    <div class="tree-sizer" style="height:{totalSize}px">
      {#each virtualItems as vi (vi.index)}
        {@const row = rows[vi.index]}
        {@const isOpen = open.has(row.path)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tree-row"
          class:wrap={settings.wrapLongLines}
          role="treeitem"
          aria-expanded={row.expandable ? isOpen : undefined}
          aria-level={row.depth + 1}
          aria-selected="false"
          tabindex="0"
          data-index={vi.index}
          use:measure
          style="transform:translateY({vi.start}px)"
          onclick={() => { if (row.expandable) toggle(row.path); }}
          onkeydown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && row.expandable) { e.preventDefault(); toggle(row.path); }
          }}
          oncontextmenu={onRowMenu ? (e) => onRowMenu(e, row.docIndex, menuKey(row)) : undefined}
        >
          {#if row.depth > 0}
            <span class="tree-guides" style="width:{row.depth}rem"></span>
          {/if}
          {#if row.expandable}
            <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" class="tree-caret">
              <path d={isOpen ? "M1.5 3l3 3 3-3" : "M3 1.5l3 3-3 3"} fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8" fill-rule="evenodd"/>
            </svg>
          {:else}
            <span class="tree-caret-pad"></span>
          {/if}

          {#if row.depth === 0}
            <!-- Doc row: index, { _id: …  (+N fields }) -->
            <span class="tree-n">{startIndex + row.docIndex + 1}</span>
            <span class="tree-brace">{"{"}</span>
            <span class="tree-key">_id</span><span class="tree-colon">:</span>
            <span class="tree-idval">{isOpen ? idFull(row.value as Doc) : idPreview(row.value as Doc)}</span>
            {#if !isOpen}
              {#if (row.childCount ?? 0) > 0}<span class="tree-muted">{fieldsSummary(row.childCount ?? 0)}</span>{/if}
              <span class="tree-brace">{"}"}</span>
            {/if}
          {:else if row.childCount !== null}
            <!-- Container row: key {N} / [N], preview when collapsed -->
            {@const info = describeValue(row.value)}
            <span class="tree-key">{row.key}</span><span class="tree-colon">:</span>
            <span class="tree-muted">{info.type === "array" ? `[${row.childCount}]` : `{${row.childCount}}`}</span>
            {#if !isOpen}<span class="tree-preview">{truncateForDisplay(info.display, 200)}</span>{/if}
          {:else}
            <!-- Leaf row: key: value  <type> -->
            {@const info = describeValue(row.value)}
            <span class="tree-key">{row.key}</span><span class="tree-colon">:</span>
            <span class="tree-val" style={valColor(row.value)}>{truncateForDisplay(info.display)}</span>
            <span class="tree-type">{info.type}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .empty { padding: 1rem; color: var(--muted); font-size: var(--fs); }
  .tree-scroller {
    overflow: auto;
    /* Size to content, capped by the parent — short results don't force-fill the pane. */
    height: auto;
    max-height: 100%;
    position: relative;
    background: var(--panel);
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.78125rem;
    line-height: 1.5;
    user-select: none;
  }
  .tree-sizer { position: relative; width: 100%; }
  .tree-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    box-sizing: border-box;
    /* Fixed height keeps measured == estimate (no scroll-thumb drift). Keep in sync with ROW_EST. */
    height: 24px;
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 0 0.625rem;
    white-space: nowrap;
    cursor: default;
  }
  .tree-row:hover { background: var(--zebra-alt); }
  /* Wrap mode: long string values may span lines; rows are measured instead of fixed. */
  .tree-row.wrap { height: auto; min-height: 24px; align-items: flex-start; white-space: normal; }
  .tree-row.wrap .tree-val { white-space: normal; word-break: break-word; }
  /* One vertical guide line per ancestor level. */
  .tree-guides {
    flex: none;
    align-self: stretch;
    background: repeating-linear-gradient(
      to right,
      transparent, transparent calc(1rem - 1px),
      var(--bg) calc(1rem - 1px), var(--bg) 1rem
    );
  }
  .tree-caret { flex: none; margin-right: 0.375rem; }
  .tree-caret-pad { flex: none; width: 9px; margin-right: 0.375rem; }
  .tree-n { color: var(--gray-99); margin-right: 0.5rem; }
  .tree-brace { color: var(--j-brace); margin-left: 0.3125rem; }
  .tree-key { color: var(--j-key); margin-left: 0.375rem; }
  .tree-colon { color: var(--gray-55); }
  .tree-idval { color: var(--j-id); margin-left: 0.3125rem; }
  .tree-val { margin-left: 0.3125rem; overflow: hidden; text-overflow: ellipsis; }
  .tree-muted { color: var(--gray-b8); margin-left: 0.5rem; }
  .tree-preview { color: var(--gray-b8); margin-left: 0.5rem; overflow: hidden; text-overflow: ellipsis; }
  .tree-type { color: var(--gray-b8); font-size: 0.6875rem; margin-left: 0.75rem; flex: none; }
</style>
