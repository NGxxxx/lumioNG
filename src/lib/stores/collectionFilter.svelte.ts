import { parseFilter, addCondition, type FilterOp } from "../domain/filter";
import { chipsFromFilter, filterFromChips, type Chip } from "../domain/filterChips";
import type { ViewPreset } from "../domain/viewPresets";
import { viewPresets } from "./viewPresets.svelte";
import { filterHistory as filterHistoryStore } from "./filterHistory.svelte";
import type { createCollectionLayout } from "./collectionLayout.svelte";

/** What the filter block needs from the owning collection view (all read lazily). */
export interface CollectionFilterCtx {
  /** `${sessionId}/${db}/${coll}` — keys both the filter history and the saved view presets. */
  layoutKey: string;
  layout: ReturnType<typeof createCollectionLayout>;
  /** Drops the inferred schema (a new filter re-samples it). */
  clearSchema: () => void;
  loadSchema: () => Promise<void>;
  bumpGeneration: () => number;
  loadFirstPage: () => Promise<void>;
}

/** The Mongo query filter of one collection view: draft text, applied JSON, chips and named view presets. */
export function createCollectionFilter(ctx: CollectionFilterCtx) {
  const layoutKey = ctx.layoutKey;
  const historyKey = layoutKey;
  const layout = ctx.layout;
  let filterText = $state("");
  let filterError = $state<string | null>(null);
  let appliedFilter = $state("{}");

  // ── Filter chips (spec §2): chips mirror the applied filter; null = not chip-representable ──
  const chips = $derived<Chip[] | null>(chipsFromFilter(appliedFilter));

  /** Replaces the filter with these chips and applies it at once. */
  async function setChips(next: Chip[]) {
    filterText = filterFromChips(next);
    await applyFilter();
  }

  /** Merges `path op value` into the filter text and runs it; an unparsable current filter is reported, not overwritten. */
  async function filterBy(path: string, op: FilterOp, value?: unknown) {
    // Build on what is actually applied — an unapplied draft in the box must not sneak in.
    const r = addCondition(appliedFilter, path, op, value);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    filterText = r.text;
    await applyFilter();
  }

  /** Sets the filter a not-yet-initialized view starts with (no load; `init()` then loads it once). */
  function presetFilter(text: string) {
    const r = parseFilter(text);
    if (!r.ok) return;
    filterText = r.json;
    appliedFilter = r.json;
  }

  async function applyFilter() {
    const r = parseFilter(filterText);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    appliedFilter = r.json;
    filterError = null;
    filterHistoryStore.record(historyKey, r.json);
    ctx.clearSchema();
    ctx.bumpGeneration();
    await ctx.loadSchema();
    await ctx.loadFirstPage();
  }

  // ── Named view presets: filter + layout, saved per namespace ──
  const presets = $derived(viewPresets.list(layoutKey));

  function saveViewPreset(name: string) {
    if (!name.trim()) return;
    viewPresets.save(layoutKey, {
      name,
      filter: appliedFilter,
      sort: layout.sortKeys,
      hidden: [...layout.hidden],
      pinned: [...layout.pinned],
      mode: layout.view,
    });
  }

  function removeViewPreset(name: string) {
    viewPresets.remove(layoutKey, name);
  }

  /** Switches to the preset's layout and filter, back on page 1. A preset whose filter no longer
   *  parses changes nothing and reports the filter error. */
  async function applyViewPreset(p: ViewPreset) {
    const r = parseFilter(p.filter);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    layout.applyPresetLayout(p);
    filterText = r.json;
    await applyFilter();
  }

  return {
    get filterText() { return filterText; },
    set filterText(v: string) { filterText = v; },
    get filterError() { return filterError; },
    get appliedFilter() { return appliedFilter; },
    /** Chips of the applied filter; null when it can only be edited as JSON. */
    get chips() { return chips; },
    get presets() { return presets; },
    setChips,
    filterBy,
    presetFilter,
    applyFilter,
    saveViewPreset,
    removeViewPreset,
    applyViewPreset,
  };
}
