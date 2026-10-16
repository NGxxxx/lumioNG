import { untrack } from "svelte";
import { get } from "svelte/store";
import type { VirtualItem } from "@tanstack/svelte-virtual";
import { createRowVirtualizer } from "./rowVirtualizer.svelte";

/** A virtualized live list, newest at the bottom: it follows new rows while scrolled to the end and
 *  counts the ones that arrive while the user has scrolled up to read. */
export function createFollowList(opts: { count: () => number; rowHeight: number }) {
  let scroller = $state<HTMLDivElement | null>(null);
  let follow = $state(true);
  let seen = $state(0);
  let items = $state.raw<VirtualItem[]>([]);
  let total = $state(0);
  const rows = createRowVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: opts.count,
    getScrollElement: () => scroller,
    estimateSize: () => opts.rowHeight,
    overscan: 12,
  });
  $effect(() =>
    rows.subscribe((v) => {
      items = v.getVirtualItems();
      total = v.getTotalSize();
    }),
  );
  $effect(() => {
    const n = opts.count();
    if (!follow) return;
    seen = n;
    if (n) untrack(() => get(rows).scrollToIndex(n - 1, { align: "end" }));
  });

  return {
    get scroller() { return scroller; },
    set scroller(el: HTMLDivElement | null) { scroller = el; },
    get items() { return items; },
    get total() { return total; },
    /** Rows that arrived while the user was scrolled up. */
    get unseen() { return follow ? 0 : Math.max(0, opts.count() - seen); },
    onScroll() {
      if (!scroller) return;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - opts.rowHeight;
      if (atEnd !== follow) follow = atEnd;
      if (atEnd) seen = opts.count();
    },
    /** Stop following (the user picked a row) and bring row `i` into view. */
    reveal(i: number) {
      follow = false;
      get(rows).scrollToIndex(i);
    },
    hold() {
      follow = false;
    },
    jumpToLatest() {
      follow = true;
    },
  };
}
