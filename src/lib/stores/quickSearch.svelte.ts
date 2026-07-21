import { compileSearch } from "../domain/search";
import { SEARCH_DEBOUNCE_MS } from "../domain/timing";

/** Client-side quick search (HeidiSQL-style): filters the currently loaded rows in place, no
 *  server round-trip. Shared by collectionView and queryScript — was hand-duplicated in both.
 *  matchingIndices() rescans every doc/column on every keystroke; debounce it (immediate on
 *  clear) so typing stays smooth once the doc set is large (e.g. "Show all" on thousands of rows). */
export function createQuickSearch() {
  let searchTerm = $state("");
  let searchApplied = $state("");
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;

  const searchRegex = $derived(compileSearch(searchTerm));
  const searchInvalid = $derived(searchTerm !== "" && searchRegex === null);
  const appliedSearchRegex = $derived(compileSearch(searchApplied));

  function setSearchTerm(v: string) {
    searchTerm = v;
    clearTimeout(searchDebounce);
    if (v === "") searchApplied = "";
    else searchDebounce = setTimeout(() => { searchApplied = v; }, SEARCH_DEBOUNCE_MS);
  }

  return {
    get searchTerm() { return searchTerm; },
    set searchTerm(v: string) { setSearchTerm(v); },
    get searchInvalid() { return searchInvalid; },
    get appliedSearchRegex() { return appliedSearchRegex; },
  };
}
