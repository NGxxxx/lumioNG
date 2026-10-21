<script lang="ts">
  import { get } from "svelte/store";
  import { untrack } from "svelte";
  import { createRowVirtualizer } from "./rowVirtualizer.svelte";
  import type { Doc } from "../domain/doc";
  import { flattenEditableDoc, existingKeysAt, setAtPath, removeAtPath, insertAtPath, allExpandablePaths, findFieldMatches, ancestorPathsOf, type EditRow, type FieldMatch, type PathSegment } from "../domain/editTree";
  import { describeValue } from "../domain/extjson";
  import { isEncryptedBinary } from "../domain/csfle";
  import { hasInput, type LeafInputType } from "../domain/bsontree";
  import { createDebouncer, SEARCH_DEBOUNCE_MS } from "../domain/timing";
  import type { OpEntry } from "../domain/mongoOps";
  import TreeLeafInput from "./TreeLeafInput.svelte";
  import TreeAdderRow from "./TreeAdderRow.svelte";
  import * as m from "#lib/paraglide/messages.js";

  /** Virtualized, collapsed-by-default editor for a single document — only mounts visible/expanded rows, unlike the old fully-recursive TreeNode. */
  let {
    value,
    onchange,
    onvalidchange,
    lockedKeys = ["_id"],
    compact = false,
    fieldSuggestions = [],
    operatorSuggestionsFor,
    onencrypt,
    encryptedPaths,
  }: {
    value: Doc;
    onchange: (v: Doc) => void;
    onvalidchange: (valid: boolean) => void;
    lockedKeys?: string[];
    /** Hides the find-field-by-name search box and expand/collapse-all button — for small bodies
     *  (e.g. a Pipeline Builder stage) where that toolbar is pure clutter, not for full documents. */
    compact?: boolean;
    /** Field names sampled from the collection, forwarded only to the root-level "add field" row. */
    fieldSuggestions?: string[];
    /** Maps a tree depth (0 = stage-body root) to extra operator suggestions for the adder row's
     *  name input — only meaningful for the Pipeline Builder (see PipelineStageCard.svelte); plain
     *  document editing never passes this. */
    operatorSuggestionsFor?: (depth: number) => readonly OpEntry[];
    /** When set, editable fields get an "Encrypt with key…" button (client-side field level encryption). */
    onencrypt?: (target: { segments: PathSegment[]; path: string; value: unknown }) => void;
    /** Row paths that are ciphertext in the database (shown decrypted): they get an "Encrypted" badge. */
    encryptedPaths?: ReadonlySet<string>;
  } = $props();

  // Persists across edits (value changes on every keystroke) — only reset by remounting
  // TreeEditor itself (a new document/tab), never by editing the current one.
  // In compact mode (Pipeline Builder stage bodies — always small) everything starts expanded, so
  // the user doesn't have to click into every field manually. Full document editing (compact
  // false) keeps collapsed-by-default: those documents can be large/deep, and auto-expanding them
  // would be a real performance regression (see $state.raw usage elsewhere in this file).
  let open = $state<Set<string>>(untrack(() => (compact ? allExpandablePaths(value) : new Set())));

  // Debounced, not $derived: a plain $derived would re-walk every OPEN row on every keystroke; only this display list lags, no edit is lost (TreeLeafInput's own buffer).
  const ROWS_DEBOUNCE_MS = 120;
  let rows = $state<EditRow[]>(untrack(() => flattenEditableDoc(value, open, lockedKeys)));
  $effect(() => {
    const v = value, o = open;
    const timer = setTimeout(() => { rows = flattenEditableDoc(v, o, lockedKeys); }, ROWS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  function toggle(path: string) {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    open = next;
    allExpanded = false; // a manual toggle can no longer mean "everything is open"
  }

  // Best-effort flag, not a derived "is everything open" check — that would re-walk the whole doc on every render.
  let allExpanded = $state(untrack(() => compact));
  function toggleExpandAll() {
    if (allExpanded) {
      open = new Set();
      allExpanded = false;
    } else {
      open = allExpandablePaths(value);
      allExpanded = true;
    }
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

  // pre: true — must resync count before the DOM re-renders shorter `rows`, or a stale virtualItems indexes past it and throws.
  const rowVirtualizer = createRowVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: () => rows.length,
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_EST,
    overscan: OVERSCAN,
    pre: true,
  });

  const virtualItems = $derived($rowVirtualizer.getVirtualItems());
  const totalSize = $derived($rowVirtualizer.getTotalSize());

  // Rows aren't all the same height (a wrapped long-string textarea is taller); measure every
  // mounted row so the virtualizer's offsets stay correct.
  function measure(node: HTMLDivElement) {
    get(rowVirtualizer).measureElement(node);
    return {};
  }

  // Find field by name: a snapshot search over `value`, not a live-tracked view — re-run on demand
  // (debounced), not on every doc edit, for the same reason `rows` is debounced above.
  let searchQuery = $state("");
  let matches = $state<FieldMatch[]>([]);
  let matchIndex = $state(0);
  let highlightPath = $state<string | null>(null);
  const searchDebouncer = createDebouncer(SEARCH_DEBOUNCE_MS);

  function onSearchInput() {
    searchDebouncer.schedule(runSearch);
  }

  function runSearch() {
    matches = findFieldMatches(value, searchQuery);
    matchIndex = 0;
    if (matches.length > 0) jumpToMatch(0);
    else highlightPath = null;
  }

  /** Opens just the ancestor chain of one match (not the whole tree) and scrolls it into view. */
  function jumpToMatch(idx: number) {
    const m = matches[idx];
    if (!m) return;
    matchIndex = idx;
    const next = new Set(open);
    for (const a of ancestorPathsOf(m.path)) next.add(a);
    open = next;
    allExpanded = false;
    highlightPath = m.path;
    rows = flattenEditableDoc(value, open, lockedKeys); // bypass the debounce — this is a deliberate jump, not a keystroke burst
    const rowIdx = rows.findIndex((r) => r.path === m.path);
    if (rowIdx !== -1) get(rowVirtualizer).scrollToIndex(rowIdx, { align: "center" });
  }

  function nextMatch() {
    if (matches.length > 0) jumpToMatch((matchIndex + 1) % matches.length);
  }
  function prevMatch() {
    if (matches.length > 0) jumpToMatch((matchIndex - 1 + matches.length) % matches.length);
  }

  $effect(() => {
    return () => {
      searchDebouncer.cancel();
    };
  });
</script>

{#snippet encryptBtn(row: Extract<EditRow, { kind: "field" }>)}
  {#if onencrypt && !row.locked && !isEncryptedBinary(row.value)}
    <button class="x enc" onclick={() => onencrypt({ segments: row.segments, path: row.path, value: row.value })} title={m.csfle_encrypt_with_key()} aria-label={m.csfle_encrypt_with_key()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><rect x="2" y="5" width="7" height="5" rx="1" fill="currentColor"/><path d="M3.5 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>
    </button>
  {/if}
{/snippet}

{#snippet encBadge(row: Extract<EditRow, { kind: "field" }>)}
  {#if encryptedPaths?.has(row.path)}<span class="badge enc-badge" title={m.csfle_encrypted_badge_title()}>{m.csfle_encrypted_badge()}</span>{/if}
{/snippet}

<div class="tree-wrap">
  {#if !compact}
    <div class="tree-toolbar">
      <div class="tree-search">
        <input
          class="tree-search-input"
          type="text"
          placeholder={m.tree_search_placeholder()}
          bind:value={searchQuery}
          oninput={onSearchInput}
          onkeydown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.shiftKey) prevMatch(); else nextMatch();
          }}
        />
        {#if searchQuery.trim()}
          <span class="tree-search-count">
            {matches.length === 0 ? m.tree_search_no_results() : m.tree_search_count({ index: matchIndex + 1, total: matches.length })}
          </span>
          <button class="tree-toolbar-btn" onclick={prevMatch} disabled={matches.length === 0} aria-label={m.tree_search_prev()}>▲</button>
          <button class="tree-toolbar-btn" onclick={nextMatch} disabled={matches.length === 0} aria-label={m.tree_search_next()}>▼</button>
        {/if}
      </div>
      <button class="tree-toolbar-btn" onclick={toggleExpandAll}>
        {allExpanded ? m.result_tree_collapse_all() : m.result_tree_expand_all()}
      </button>
    </div>
  {/if}
  <div class="tree-scroller" bind:this={scrollerEl} role="tree">
    <div class="tree-sizer" style="height:{totalSize}px">
      {#each virtualItems as vi (rows[vi.index].path)}
        {@const row = rows[vi.index]}
        <div
          class="tree-row"
          class:tree-row-highlight={row.path === highlightPath}
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
              fieldSuggestions={row.segments.length === 0 ? fieldSuggestions : []}
              operatorSuggestions={operatorSuggestionsFor ? operatorSuggestionsFor(row.depth) : []}
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
            {@render encBadge(row)}
            {@render encryptBtn(row)}
            {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
          {:else}
            {@const info = describeValue(row.value)}
            {@const type = info.type}
            {#if hasInput(type) && !row.locked}
              <span class="tree-caret-pad"></span>
              <span class="label">{row.key}</span>
              <span class="badge">{type}</span>
              {@render encBadge(row)}
              <TreeLeafInput
                type={type as LeafInputType}
                value={row.value}
                onchange={(v) => handleSet(row, v)}
                onerror={(e) => setError(row.path, e)}
              />
              {@render encryptBtn(row)}
              {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
            {:else}
              <span class="tree-caret-pad"></span>
              <span class="label">{row.key}</span>
              <span class="badge">{type}</span>
              {@render encBadge(row)}
              <span class="display">{info.display}</span>
              {#if row.locked}<span class="lock" title={m.tree_node_locked_title()}>🔒</span>{/if}
              {@render encryptBtn(row)}
              {#if row.removable}<button class="x" onclick={() => handleRemove(row)} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .tree-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .tree-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 1.75rem;
    flex: none;
    background: var(--th-grad-top);
    border-bottom: 1px solid var(--border);
    padding: 0 0.5rem;
    gap: 0.375rem;
  }
  .tree-search { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
  .tree-search-input {
    width: 11rem;
    height: 1.375rem;
    background: var(--panel);
    border: 1px solid var(--gray-c4);
    border-radius: var(--radius-sm);
    padding: 0 0.5rem;
    font-family: var(--mono);
    font-size: var(--fs);
    box-sizing: border-box;
  }
  .tree-search-count { color: var(--gray-99); font-size: var(--fs); flex: none; white-space: nowrap; }
  .tree-toolbar-btn {
    height: 1.375rem;
    padding: 0 0.5rem;
    font-size: var(--fs);
    border: 1px solid var(--gray-c4);
    background: var(--bg);
    color: var(--gray-44);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tree-toolbar-btn:hover:not(:disabled) { background: var(--cell-border); }
  .tree-toolbar-btn:disabled { opacity: 0.4; cursor: default; }

  /* flex: 1 load-bearing: absolute-positioned rows give this no intrinsic width in the row-flex parent, so it collapses to ~0px without it. */
  .tree-scroller {
    overflow: auto;
    height: 100%;
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    background: var(--panel);
    font-family: var(--mono);
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
  .tree-row-highlight { background: var(--blue-tint5); box-shadow: inset 0 0 0 1px var(--toggle-on-ring); }
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
  .label { font-family: var(--mono); font-size: 0.8125rem; color: var(--gray-33); flex: none; }
  .label.clickable { cursor: pointer; }
  .badge { background: var(--blue-tint5); color: var(--slate); padding: 0 0.375rem; border-radius: var(--radius); font-size: 0.6875rem; font-family: var(--mono); flex: none; }
  .display { color: var(--gray-55); font-family: var(--mono); font-size: 0.8125rem; }
  .x.enc { color: var(--muted); display: inline-flex; align-items: center; }
  .enc-badge { color: var(--warn-fg); background: var(--warn-bg); }
  .x { border: none; background: none; color: var(--danger-strong); cursor: pointer; font-size: var(--fs); flex: none; }
  .lock { font-size: var(--fs); flex: none; }
</style>
