import { untrack } from "svelte";
import { get } from "svelte/store";
import { createVirtualizer, type SvelteVirtualizer } from "@tanstack/svelte-virtual";
import type { Readable } from "svelte/store";

/**
 * Shared `createVirtualizer(...)` + resync wiring for the three row-virtualized components
 * (ResultGrid, ResultTree, TreeEditor). Returns the same Svelte store `createVirtualizer` itself
 * returns — callers keep using `$store` / `get(store)` / `store...scrollToIndex()` etc. exactly as
 * before; only the create-then-resync boilerplate is centralized.
 *
 * NOT the extraction gridInteractions.svelte.ts's old comment warned off: that attempt mirrored the
 * virtualizer's store into a component's `$state`, which fed back into the resync effect and looped
 * forever. This helper never touches `$state` — the store stays a store end-to-end, so the effect's
 * only reactive dependencies are whatever `count()`/`getScrollElement()` read in the caller.
 */
export function createRowVirtualizer<TScroll extends Element, TItem extends Element>(options: {
  count: () => number;
  getScrollElement: () => TScroll | null;
  estimateSize: () => number;
  overscan: number;
  /** Use `$effect.pre` instead of `$effect` for the resync — needed when the count can shrink and
   *  the DOM re-renders before a regular `$effect` would run (see TreeEditor.svelte). */
  pre?: boolean;
}): Readable<SvelteVirtualizer<TScroll, TItem>> {
  const { count, getScrollElement, estimateSize, overscan, pre = false } = options;

  const virtualizer = createVirtualizer<TScroll, TItem>({
    count: untrack(count),
    getScrollElement,
    estimateSize,
    overscan,
  });

  function resync() {
    const c = count();
    const el = getScrollElement();
    get(virtualizer).setOptions({
      count: c,
      getScrollElement: () => el,
      estimateSize,
      overscan,
    });
  }

  if (pre) {
    $effect.pre(resync);
  } else {
    $effect(resync);
  }

  return virtualizer;
}
