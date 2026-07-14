<script lang="ts">
  import { tick } from "svelte";
import type { createCollectionView } from "../stores/collectionView.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";
  import GridDepthSelect from "./GridDepthSelect.svelte";

  let { v, view = $bindable("grid"), onexpandall, oncollapseall }: {
    v: ReturnType<typeof createCollectionView>;
    view?: "grid" | "tree";
    onexpandall?: () => void;
    oncollapseall?: () => void;
  } = $props();

  let openDropdown = $state<"sort" | "fields" | null>(null);
  let searchInputEl = $state<HTMLInputElement | null>(null);

  // Imperative command for the global toolbar's "Find" button (bind:this); search box only renders in Grid view, so switch there first.
  export async function focusSearch() {
    if (view !== "grid") view = "grid";
    await tick();
    searchInputEl?.focus();
  }

  function toggleDropdown(which: "sort" | "fields") {
    if (which === "fields" && openDropdown !== "fields") v.resetProjectionDraft();
    openDropdown = openDropdown === which ? null : which;
  }
  function closeDropdown() {
    openDropdown = null;
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

  const visibleColumns = $derived(v.columnFields.filter((c) => !v.hidden.has(c.path)));

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

  function applyFields() {
    v.applyProjection();
    closeDropdown();
  }
</script>

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
  {#if view === "grid"}
    <input
      class="search-input"
      class:search-invalid={v.searchInvalid}
      bind:this={searchInputEl}
      bind:value={v.searchTerm}
      placeholder={m.result_table_search_placeholder()}
      title={m.result_table_search_title()}
      aria-label={m.result_table_search_title()}
    />
  {/if}
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
    {#if view === "tree"}
      <button class="toggle-btn" onclick={() => onexpandall?.()} title={m.result_tree_expand_all()}>
        {m.result_tree_expand_all()}
      </button>
      <button class="toggle-btn" onclick={() => oncollapseall?.()} title={m.result_tree_collapse_all()}>
        {m.result_tree_collapse_all()}
      </button>
    {/if}
    {#if view === "grid"}
      <GridDepthSelect />
    {/if}
  </div>
</div>
{#if v.filterError}<div class="error">{msgKey(v.filterError)}</div>{/if}

<style>
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

  /* ── Quick search (client-side regex filter over the loaded rows) ── */
  .search-input {
    width: 9rem;
    height: 1.3125rem;
    margin-left: 0.375rem;
    background: var(--panel);
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    padding: 0 0.5rem;
    font-family: Consolas, monospace;
    font-size: 0.75rem;
    box-sizing: border-box;
  }
  .search-invalid { border-color: var(--error); color: var(--error); }

  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }

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
  .dd-allnone button { flex: 1; font-size: 0.6875rem; padding: 0.125rem 0; cursor: pointer; border: none; background: none; color: var(--link); }
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
  .dd-clear { margin-top: 0.375rem; width: 100%; font-size: 0.6875rem; cursor: pointer; border: none; background: none; color: var(--link); }
</style>
