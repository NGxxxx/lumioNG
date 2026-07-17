export type CollectionSortMode = "default" | "asc" | "desc";

const STORAGE_KEY = "collection-sort";
const DEFAULT: CollectionSortMode = "default";

function readSaved(): CollectionSortMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "default" || v === "asc" || v === "desc" ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Reactive sidebar collection-sort mode: "default" keeps server order, "asc"/"desc" sorts A-Z / Z-A. */
export function createCollectionSort() {
  let current = $state<CollectionSortMode>(typeof localStorage !== "undefined" ? readSaved() : DEFAULT);

  return {
    get current(): CollectionSortMode {
      return current;
    },
    set(mode: CollectionSortMode) {
      if (mode === current) return;
      current = mode;
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* storage unavailable — keep the in-memory setting */
      }
    },
  };
}

export const collectionSort = createCollectionSort();
