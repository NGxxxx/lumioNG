<script lang="ts">
  import { untrack } from "svelte";
  import { get } from "svelte/store";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import type { Doc } from "../domain/doc";
  import { describeValue, truncateForDisplay } from "../domain/extjson";
  import { jsonValueColor, bsonValueKind } from "../domain/theme";
  import { settings } from "../stores/settings.svelte";
  import * as m from "$lib/paraglide/messages";

  /**
   * Shared, virtualized tree view for both the collection data grid and query results.
   * Only the visible documents are rendered; row heights are measured so expanding a doc
   * (variable height) stays smooth even with 25k+ rows. `startIndex` offsets the row number
   * (collection view passes the page offset; query view leaves it 0 = page-local numbering).
   * `onRowMenu` lets the parent open its own context menu (copy/open/export/delete) on right-click.
   */
  let { docs, startIndex = 0, onRowMenu }:
    { docs: Doc[]; startIndex?: number; onRowMenu?: (e: MouseEvent, index: number) => void } = $props();

  let openRows = $state<Set<number>>(new Set());
  function toggle(i: number) {
    const next = new Set(openRows);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    openRows = next;
  }

  // Reset expansion when the underlying docs change (paging/sort/filter/new query) so a
  // previously-open index doesn't show the wrong row — and stale heights get re-measured.
  let lastDocs = untrack(() => docs);
  $effect(() => {
    if (docs !== lastDocs) {
      lastDocs = docs;
      openRows = new Set();
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

  /** _id display. Collapsed → truncated preview; expanded → full value (shown right after `{`). */
  function idFull(doc: Doc): string {
    const id = doc._id;
    return id === undefined || id === null ? "(no _id)" : describeValue(id).display;
  }
  function idPreview(doc: Doc): string {
    const s = idFull(doc);
    return s.length > 32 ? s.slice(0, 31) + "…" : s;
  }
  function extraFields(doc: Doc): number {
    return Object.keys(doc).length - ("_id" in doc ? 1 : 0);
  }
  /** Fields shown in the expanded body — everything except _id (which sits on the header line). */
  function otherEntries(doc: Doc): [string, unknown][] {
    return Object.entries(doc).filter(([k]) => k !== "_id");
  }

  // === Virtualization (variable row height → measureElement) ===
  // Collapsed rows are uniform and locked to ROW_EST px in CSS (.tree-doc fixed height), so the
  // virtualizer's estimate matches their *measured* height exactly — no totalSize churn while
  // scrolling => the scrollbar thumb tracks the drag 1:1. Only expanded rows measure taller.
  // MUST match `.tree-doc { height }` in the CSS below.
  const ROW_EST = 27; // collapsed-row height (px); expanded rows are measured
  const OVERSCAN = 6;
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: untrack(() => docs.length),
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_EST,
    overscan: OVERSCAN,
  });

  $effect(() => {
    const count = docs.length;
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

  // Register each rendered row so its real (collapsed/expanded) height refines the layout.
  function measure(node: HTMLDivElement) {
    get(rowVirtualizer).measureElement(node);
    return {};
  }
</script>

{#if docs.length === 0}
  <div class="empty">{m.result_tree_empty()}</div>
{:else}
  <div class="tree-scroller" bind:this={scrollerEl}>
    <div class="tree-sizer" style="height:{totalSize}px">
      {#each virtualItems as vi (vi.index)}
        {@const i = vi.index}
        {@const doc = docs[i]}
        {@const isOpen = openRows.has(i)}
        {@const extra = extraFields(doc)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tree-doc"
          class:open={isOpen}
          data-index={vi.index}
          use:measure
          style="transform:translateY({vi.start}px)"
          oncontextmenu={onRowMenu ? (e) => onRowMenu(e, i) : undefined}
        >
          <div
            class="tree-header"
            role="button"
            tabindex="0"
            onclick={() => toggle(i)}
            onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); } }}
          >
            <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" class="tree-caret" class:tree-caret-open={isOpen}>
              <path d={isOpen ? "M1.5 3l3 3 3-3" : "M3 1.5l3 3-3 3"} fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8" fill-rule="evenodd"/>
            </svg>
            <span class="tree-n">{startIndex + i + 1}</span>
            <span class="tree-brace">{"{"}</span>
            <span class="tree-idkey">_id</span><span class="tree-colon">:</span><span class="tree-idval">{isOpen ? idFull(doc) : idPreview(doc)}</span>
            {#if !isOpen}
              {#if extra > 0}<span class="tree-summary">+{extra} field{extra > 1 ? "s" : ""}</span>{/if}
              <span class="tree-brace tree-brace-close">{"}"}</span>
            {/if}
          </div>
          {#if isOpen}
            <div class="tree-body">
              {#each otherEntries(doc) as [key, val] (key)}
                <div class="tree-line" class:wrap={settings.wrapLongLines}>
                  <span class="tree-key">{key}</span><span class="tree-colon">:</span><span class="tree-val" style={valColor(val)}>{truncateForDisplay(describeValue(val).display)}</span>
                </div>
              {/each}
              <div class="tree-close">{"}"}</div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .empty { padding: 1rem; color: var(--muted); font-size: 0.75rem; }
  .tree-scroller {
    overflow: auto;
    height: 100%;
    position: relative;
    background: var(--panel);
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.78125rem;
    line-height: 1.55;
    user-select: none;
  }
  /* Spacer that holds the full virtual height; rows are absolutely positioned within it. */
  .tree-sizer { position: relative; width: 100%; }
  .tree-doc {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    box-sizing: border-box;
    /* Collapsed rows are a fixed height so measured == ROW_EST estimate (no scroll-thumb drift).
       Open rows grow to fit their fields. Keep this height in sync with ROW_EST in the script. */
    height: 27px;
    overflow: hidden;
    border-bottom: 1px solid var(--bg);
    padding: 0.125rem 0;
  }
  .tree-doc.open {
    height: auto;
    overflow: visible;
  }
  .tree-header {
    display: flex;
    align-items: center;
    padding: 0.0625rem 0.625rem;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
  }
  .tree-header:hover { background: var(--zebra-alt); }
  .tree-caret { flex: none; margin-right: 0.375rem; transition: transform 0.1s; }
  .tree-n { color: var(--gray-99); margin-right: 0.5rem; }
  .tree-brace { color: var(--j-brace); }
  .tree-brace-close { margin-left: 0.3125rem; }
  .tree-idkey { color: var(--j-key); margin-left: 0.375rem; }
  .tree-colon { color: var(--gray-55); }
  .tree-idval { color: var(--j-id); margin-left: 0.3125rem; }
  .tree-summary { color: var(--gray-b8); margin-left: 0.5rem; }
  .tree-body { padding: 0.0625rem 0 0.25rem 0; }
  /* Default: no-wrap, scrolls horizontally via .tree-scroller. Toolbar's Wrap toggle enables .wrap. */
  .tree-line {
    padding: 0 0.625rem 0 1.625rem;
    white-space: nowrap;
  }
  .tree-line.wrap {
    white-space: normal;
    word-break: break-word;
  }
  .tree-key { color: var(--j-key); }
  .tree-colon { color: var(--gray-55); }
  .tree-val { margin-left: 0.3125rem; }
  .tree-close { padding: 0.0625rem 0.625rem 0.0625rem 1.375rem; color: var(--j-brace); }
</style>
