import { compileSearch } from "../domain/search";
import { createDebouncer, SEARCH_DEBOUNCE_MS } from "../domain/timing";

/** Client-side quick search (HeidiSQL-style): filters loaded rows in place, no server round-trip; debounced since it rescans every doc/column. */
export function createQuickSearch() {
  let searchTerm = $state("");
  let searchApplied = $state("");
  const debouncer = createDebouncer(SEARCH_DEBOUNCE_MS);

  const searchRegex = $derived(compileSearch(searchTerm));
  const searchInvalid = $derived(searchTerm !== "" && searchRegex === null);
  const appliedSearchRegex = $derived(compileSearch(searchApplied));

  function setSearchTerm(v: string) {
    searchTerm = v;
    if (v === "") {
      debouncer.cancel();
      searchApplied = "";
    } else {
      debouncer.schedule(() => { searchApplied = v; });
    }
  }

  return {
    get searchTerm() { return searchTerm; },
    set searchTerm(v: string) { setSearchTerm(v); },
    get searchInvalid() { return searchInvalid; },
    get appliedSearchRegex() { return appliedSearchRegex; },
  };
}
