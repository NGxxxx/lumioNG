import { prefs } from "./prefs.svelte";

export type CollectionSortMode = "default" | "asc" | "desc";

const STORAGE_KEY = "collection-sort";
const DEFAULT: CollectionSortMode = "default";

function readSaved(): CollectionSortMode {
  const v = prefs.getItem(STORAGE_KEY);
  return v === "default" || v === "asc" || v === "desc" ? v : DEFAULT;
}

/** Reactive sidebar collection-sort mode: "default" keeps server order, "asc"/"desc" sorts A-Z / Z-A. */
export function createCollectionSort() {
  let current = $state<CollectionSortMode>(readSaved());
  prefs.afterHydrate(() => (current = readSaved()));

  return {
    get current(): CollectionSortMode {
      return current;
    },
    set(mode: CollectionSortMode) {
      if (mode === current) return;
      current = mode;
      prefs.setItem(STORAGE_KEY, mode);
    },
  };
}

export const collectionSort = createCollectionSort();
