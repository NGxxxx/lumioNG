<script lang="ts">
  import { tick } from "svelte";
import type { createCollectionView } from "../stores/collectionView.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import FilterChips from "./FilterChips.svelte";
  import { clickOutside } from "../actions/clickOutside";
  import { chipsFromFilter } from "../domain/filterChips";
  import { msgKey } from "#lib/msgkey.js";
  import GridDepthSelect from "./GridDepthSelect.svelte";

  let { v, view = $bindable("grid"), treeAllExpanded = false, ontoggleexpand }: {
    v: ReturnType<typeof createCollectionView>;
    view?: "grid" | "tree";
    treeAllExpanded?: boolean;
    ontoggleexpand?: () => void;
  } = $props();

  // Chips are the default view of the filter; JSON is the escape hatch (and the only view for
  // filters chips can't express).
  let filterMode = $state<"chips" | "json">("chips");
  const parseableAsChips = $derived(chipsFromFilter(v.filterText.trim() || "{}") !== null);

  let openDropdown = $state<"sort" | "fields" | "views" | null>(null);
  let presetName = $state("");

  function savePreset() {
    if (!presetName.trim()) return;
    v.saveViewPreset(presetName);
    presetName = "";
  }
  let searchInputEl = $state<HTMLInputElement | null>(null);

  // Imperative command for the global toolbar's "Find" button (bind:this); search box only renders in Grid view, so switch there first.
  export async function focusSearch() {
    if (view !== "grid") view = "grid";
    await tick();
    searchInputEl?.focus();
  }

  const unlockedFields = $derived(v.columnFields.filter((c) => c.path !== "_id"));
  const allFieldsChecked = $derived(unlockedFields.every((c) => !v.hiddenDraft.has(c.path)));
  const someFieldsChecked = $derived(unlockedFields.some((c) => !v.hiddenDraft.has(c.path)));

  /** `indeterminate` isn't a reflected HTML attribute — it must be set as a DOM property. */
  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return {
      update(v: boolean) {
        node.indeterminate = v;
      },
    };
  }

  function toggleDropdown(which: "sort" | "fields" | "views") {
    if (which === "fields" && openDropdown !== "fields") v.resetProjectionDraft();
    openDropdown = openDropdown === which ? null : which;
  }
  function closeDropdown() {
    openDropdown = null;
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
  {#if filterMode === "chips" && v.chips !== null}
    <FilterChips
      chips={v.chips}
      fields={v.fieldInfos}
      valuesFor={v.valuesFor}
      slowHint={v.slowFieldHint}
      zero={v.zeroResult}
      history={v.filterHistory}
      onchange={(c) => v.setChips(c)}
      onhistory={(t) => { v.filterText = t; void v.applyFilter(); }}
      onpin={v.pinFilter}
      onclearhistory={v.clearFilterHistory}
    />
    <button class="mode-btn" title={m.chips_json()} aria-label={m.chips_json()} onclick={() => { v.filterText = v.appliedFilter; filterMode = "json"; }}>{"{ }"}</button>
  {:else}
  {#if v.chips === null && v.appliedFilter !== "{}"}<span class="advanced" title={m.chips_advanced()}>{m.chips_advanced()}</span>{/if}
  <input
    class="filter-input"
    bind:value={v.filterText}
    placeholder={'{ age: { $gt: 30 }, _id: ObjectId("…") }'}
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
  {#if parseableAsChips}
    <button class="mode-btn" title={m.chips_chips()} aria-label={m.chips_chips()} onclick={() => (filterMode = "chips")}>≡</button>
  {/if}
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="dropwrap" use:clickOutside={closeDropdown} onkeydown={(e) => { if (e.key === "Escape") closeDropdown(); }} role="group" tabindex="-1">
    <button class="drop-btn" onclick={() => toggleDropdown("views")} title={m.views_title()}>
      {m.views_title()}{v.presets.length ? ` (${v.presets.length})` : ""} ▾
    </button>
    {#if openDropdown === "views"}
      <div class="dropdown views-dd">
        {#if v.presets.length === 0}
          <div class="dd-empty">{m.views_empty()}</div>
        {:else}
          {#each v.presets as p (p.name)}
            <div class="dd-row">
              <button class="dd-preset" title={m.views_apply_title()} onclick={() => { closeDropdown(); void v.applyViewPreset(p); }}>{p.name}</button>
              <button class="dd-ic dd-x" title={m.views_delete()} aria-label={m.views_delete()} onclick={() => v.removeViewPreset(p.name)}>×</button>
            </div>
          {/each}
        {/if}
        <form class="dd-save" onsubmit={(e) => { e.preventDefault(); savePreset(); }}>
          <input bind:value={presetName} placeholder={m.views_save_placeholder()} aria-label={m.views_save_placeholder()} />
          <button type="submit" disabled={!presetName.trim()}>{m.views_save()}</button>
        </form>
      </div>
    {/if}
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
          <label class="chooser-row">
            <input
              type="checkbox"
              checked={allFieldsChecked}
              use:indeterminate={someFieldsChecked && !allFieldsChecked}
              onchange={(e) => (e.currentTarget.checked ? v.showAllFieldsDraft() : v.hideAllFieldsDraft())}
            />
            {m.result_table_fields_select_all()}
          </label>
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
      <button
        class="toggle-btn"
        onclick={() => ontoggleexpand?.()}
        title={treeAllExpanded ? m.result_tree_collapse_all() : m.result_tree_expand_all()}
      >
        {treeAllExpanded ? m.result_tree_collapse_all() : m.result_tree_expand_all()}
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
    height: 2.75rem;
    flex: none;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 0 0.75rem 0 0.875rem;
  }
  .mode-btn {
    flex: none; height: 1.875rem; min-width: 1.875rem; padding: 0 0.375rem; border: 1px solid var(--c-surface1);
    border-radius: var(--radius); background: var(--panel); color: var(--muted); font-family: var(--mono); font-size: 0.75rem; cursor: pointer;
  }
  .mode-btn:hover { color: var(--fg); background: var(--menu-hover); }
  .advanced { flex: none; color: var(--warn-fg); font-size: 0.6875rem; white-space: nowrap; }
  .filter-input {
    flex: 1;
    min-width: 8rem;
    height: 1.875rem;
    background: var(--bg);
    border: 1px solid var(--c-surface1);
    border-radius: var(--radius);
    padding: 0 0.625rem;
    font-family: var(--mono);
    font-size: var(--fs);
    box-sizing: border-box;
  }
  .btn-run {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 1.875rem;
    padding: 0 0.875rem;
    background: var(--run);
    color: var(--on-accent);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-weight: 600;
    font-size: var(--fs);
  }
  .btn-run:hover { background: var(--run-hover); }

  /* ── Grid / Tree toggle ── */
  /* Segmented control: one bordered track, the active segment is a raised chip. */
  .view-toggle {
    display: flex; align-items: center; gap: 0.125rem; margin-left: 0.25rem; padding: 0.125rem;
    border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg);
  }
  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    height: 1.5rem;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--muted);
    border-radius: var(--radius-sm);
  }
  .toggle-btn:hover { color: var(--fg); }
  .toggle-active {
    background: var(--menu-hover);
    box-shadow: 0 0 0 1px var(--c-surface1);
    color: var(--fg);
  }

  /* ── Quick search (client-side regex filter over the loaded rows) ── */
  .search-input {
    width: 9rem;
    height: 1.875rem;
    margin-left: 0.375rem;
    background: var(--bg);
    border: 1px solid var(--c-surface1);
    border-radius: var(--radius);
    padding: 0 0.625rem;
    font-family: var(--mono);
    font-size: var(--fs);
    box-sizing: border-box;
  }
  .search-invalid { border-color: var(--error); color: var(--error); }

  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }

  /* ── Column chooser ── */
  .chooser-row { display: block; font-size: var(--fs); padding: 0.125rem 0; white-space: nowrap; }
  .chooser-apply {
    display: block;
    margin: 0.5rem 0 0.125rem auto;
    height: 1.75rem;
    padding: 0 0.75rem;
    font-size: var(--fs);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: var(--run);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .chooser-apply:hover { background: var(--run-hover); }

  /* ── Header dropdowns (Sort / Fields) ── */
  .dropwrap { position: relative; display: flex; align-items: center; gap: 0.25rem; margin-left: 0.25rem; }
  .dropwrap:focus { outline: none; }
  .drop-btn {
    height: 1.875rem; padding: 0 0.625rem; font-size: 0.75rem;
    border: 1px solid var(--c-surface1); background: var(--hover); color: var(--c-subtext1);
    border-radius: var(--radius); cursor: pointer; white-space: nowrap;
  }
  .drop-btn:hover { background: var(--menu-hover); color: var(--fg); }
  .dropdown {
    position: absolute; z-index: 20; top: 100%; left: 0; margin-top: 0.25rem;
    background: var(--popover); border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); padding: 0.5rem;
    min-width: 11.25rem; max-height: 20rem; overflow: auto;
    box-shadow: var(--shadow-sm);
  }
  .dd-allnone { padding-bottom: 0.375rem; margin-bottom: 0.25rem; border-bottom: 1px solid var(--bg); }
  .dd-allnone .chooser-row { font-weight: 600; }
  .locked { color: var(--gray-aa); font-size: 0.625rem; margin-left: 0.25rem; }
  /* Fields popover: pin Show/Hide-all + Apply, scroll only the field list. */
  .fields-dd { display: flex; flex-direction: column; overflow: hidden; }
  .fields-dd .dd-allnone { flex: none; }
  .fields-list { flex: 1; min-height: 0; overflow: auto; border-bottom: 1px solid var(--bg); }
  .fields-dd .chooser-apply { flex: none; margin-top: 0.375rem; }

  .views-dd { min-width: 15rem; }
  .dd-preset {
    flex: 1; min-width: 0; text-align: left; padding: 0.1875rem 0.375rem; border: 0; border-radius: var(--radius-sm);
    background: none; color: var(--fg); font-size: var(--fs); cursor: pointer; overflow: hidden; text-overflow: ellipsis;
  }
  .dd-preset:hover { background: var(--menu-hover); }
  .dd-save { display: flex; gap: 0.25rem; margin-top: 0.375rem; padding-top: 0.375rem; border-top: 1px solid var(--bg); }
  .dd-save input {
    flex: 1; min-width: 0; height: 1.625rem; padding: 0 0.375rem; font-size: var(--fs);
    border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg);
  }
  .dd-save button {
    height: 1.625rem; padding: 0 0.625rem; border: 0; border-radius: var(--radius); font-size: var(--fs);
    background: var(--run); color: var(--on-accent); cursor: pointer;
  }
  .dd-save button:disabled { opacity: 0.5; cursor: default; }
  .dd-empty { color: var(--gray-99); font-size: var(--fs); padding: 0.125rem 0.125rem 0.375rem; }
  .dd-row { display: flex; align-items: center; gap: 0.25rem; font-size: var(--fs); padding: 0.125rem 0; white-space: nowrap; }
  .dd-rank { color: var(--gray-99); width: 1rem; }
  .dd-field { flex: 1; font-family: var(--mono); }
  .dd-ic {
    width: 1.25rem; height: 1.125rem; border: 1px solid var(--gray-cf); background: var(--th-grad-top);
    border-radius: var(--radius-sm); cursor: pointer; font-size: 0.6875rem; line-height: 1; padding: 0; color: var(--gray-44);
  }
  .dd-ic:hover { background: var(--tab-inactive-bg); }
  .dd-ic:disabled { opacity: 0.35; cursor: default; }
  .dd-x:hover { background: var(--error-bg); color: var(--error); }
  .dd-add { display: block; font-size: var(--fs); margin-top: 0.375rem; padding-top: 0.375rem; border-top: 1px solid var(--bg); }
  .dd-add select { margin-left: 0.375rem; font-size: var(--fs); }
  .dd-clear { margin-top: 0.375rem; width: 100%; font-size: 0.6875rem; cursor: pointer; border: none; background: none; color: var(--link); }
</style>
