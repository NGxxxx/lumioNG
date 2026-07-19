<script lang="ts">
  import { get } from "svelte/store";
  import { untrack } from "svelte";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import type { Doc } from "../domain/doc";
  import { flattenEditableDoc, existingKeysAt, setAtPath, removeAtPath, insertAtPath, type EditRow, type PathSegment } from "../domain/editTree";
  import { describeValue } from "../domain/extjson";
  import { hasInput, type LeafInputType } from "../domain/bsontree";
  import TreeLeafInput from "./TreeLeafInput.svelte";
  import TreeAdderRow from "./TreeAdderRow.svelte";
  import * as m from "$lib/paraglide/messages";

  /** Virtualized, collapsed-by-default editor for a single document. Only mounts rows that are
   *  actually visible/expanded — unlike the old fully-recursive TreeNode, cost no longer scales
   *  with total document size (that was the ~2GB RAM / hang source on large documents). */
  let {
    value,
    onchange,
    onvalidchange,
  }: {
    value: Doc;
    onchange: (v: Doc) => void;
    onvalidchange: (valid: boolean) => void;
  } = $props();

  const LOCKED_KEYS = ["_id"];

  // Persists across edits (value changes on every keystroke) — only reset by remounting
  // TreeEditor itself (a new document/tab), never by editing the current one.
  let open = $state<Set<string>>(new Set());
  const rows = $derived(flattenEditableDoc(value, open, LOCKED_KEYS));

  function toggle(path: string) {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    open = next;
  }

  let errorPaths = $state(new Set<string>());
  function setError(path: string, hasError: boolean) {
    const next = new Set(errorPaths);
    if (hasError) next.add(path);
    else next.delete(path);
    errorPaths = next;
    onvalidchange(next.size === 0);
  }

  function handleSet(row: Extract<EditRow, { kind: "field" }>, v: unknown) {
    onchange(setAtPath(value, row.segments, v) as Doc);
  }
  function handleRemove(row: Extract<EditRow, { kind: "field" }>) {
    setError(row.path, false);
    onchange(removeAtPath(value, row.segments) as Doc);
  }
  function handleAdd(containerSegments: PathSegment[], name: string | null, v: unknown) {
    onchange(insertAtPath(value, containerSegments, name, v) as Doc);
  }

  const ROW_EST = 24;
  const OVERSCAN = 12;
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

  // Rows aren't all the same height (a wrapped long-string textarea is taller); measure every
  // mounted row so the virtualizer's offsets stay correct.
  function measure(node: HTMLDivElement) {
    get(rowVirtualizer).measureElement(node);
    return {};
  }
</script>

<div class="tree-scroller" bind:this={scrollerEl} role="tree">
  <div class="tree-sizer" style="height:{totalSize}px">
    {#each virtualItems as vi (rows[vi.index].path)}
      {@const row = rows[vi.index]}
      <div
        class="tree-row"
        style="transform:translateY({vi.start}px)"
        data-index={vi.index}
        use:measure
      >
        {#if row.depth > 0}
          <span class="tree-guides" style="width:{row.depth}rem"></span>
        {/if}
        {#if row.kind === "adder"}
          <span class="tree-caret-pad"></span>
          <TreeAdderRow
            isArray={row.isArray}
            existingKeys={row.isArray ? [] : existingKeysAt(value, row.segments)}
            onadd={(name, v) => handleAdd(row.segments, name, v)}
          />
        {:else if row.expandable}
          <!-- No describeValue() here on purpose: it would JSON.stringify the whole container just
               to get `.display`, which this branch never uses (badge shows childCount instead) --
               that's exactly the O(n)-per-row cost the virtualized rewrite was meant to avoid. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" class="tree-caret" onclick={() => toggle(row.path)}>
            <path d={open.has(row.path) ? "M1.5 3l3 3 3-3" : "M3 1.5l3 3-3 3"} fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8" fill-rule="evenodd"/>
          </svg>
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <span class="label clickable" onclick={() => toggle(row.path)}>{row.key}</span>
          <span class="badge">{Array.isArray(row.value) ? `array[${row.childCount}]` : "object"}</span>
          {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
        {:else}
          {@const info = describeValue(row.value)}
          {@const type = info.type}
          {#if hasInput(type) && !row.locked}
            <span class="tree-caret-pad"></span>
            <span class="label">{row.key}</span>
            <span class="badge">{type}</span>
            <TreeLeafInput
              type={type as LeafInputType}
              value={row.value}
              onchange={(v) => handleSet(row, v)}
              onerror={(e) => setError(row.path, e)}
            />
            {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
          {:else}
            <span class="tree-caret-pad"></span>
            <span class="label">{row.key}</span>
            <span class="badge">{type}</span>
            <span class="display">{info.display}</span>
            {#if row.locked}<span class="lock" title={m.tree_node_locked_title()}>🔒</span>{/if}
            {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tree-scroller {
    overflow: auto;
    height: 100%;
    position: relative;
    background: var(--panel);
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.8125rem;
  }
  .tree-sizer { position: relative; width: 100%; }
  .tree-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    box-sizing: border-box;
    min-height: 24px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.0625rem 0.75rem;
  }
  .tree-row:hover { background: var(--zebra-alt); }
  .tree-guides {
    flex: none;
    align-self: stretch;
    background: repeating-linear-gradient(
      to right,
      transparent, transparent calc(1rem - 1px),
      var(--bg) calc(1rem - 1px), var(--bg) 1rem
    );
  }
  .tree-caret { flex: none; cursor: pointer; }
  .tree-caret-pad { flex: none; width: 9px; }
  .label { font-family: ui-monospace, monospace; font-size: 0.8125rem; color: var(--gray-33); flex: none; }
  .label.clickable { cursor: pointer; }
  .badge { background: var(--blue-tint5); color: var(--slate); padding: 0 0.375rem; border-radius: 0.1875rem; font-size: 0.6875rem; font-family: ui-monospace, monospace; flex: none; }
  .display { color: var(--gray-55); font-family: ui-monospace, monospace; font-size: 0.8125rem; }
  .x { border: none; background: none; color: var(--danger-strong); cursor: pointer; font-size: 0.75rem; flex: none; }
  .lock { font-size: 0.75rem; flex: none; }
</style>
