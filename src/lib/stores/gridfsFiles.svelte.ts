import { queryPage, countDocuments } from "../api/documents";
import { toGridfsFileRow, escapeRegexLiteral, type GridfsFileRow } from "../domain/gridfsFiles";
import { createDebouncer, SEARCH_DEBOUNCE_MS } from "../domain/timing";
import { errorMessage } from "../api/errors";

const DEFAULT_PAGE_SIZE = 50;
const SORT_BY_UPLOAD_DATE_DESC = '{"uploadDate":-1}';

/** Per-bucket store backing the GridFS file browser panel: paginated, searchable listing of a
 *  `<bucket>.files` collection via the existing generic `queryPage`/`countDocuments` commands --
 *  no dedicated "list files" backend command needed, `<bucket>.files` is an ordinary collection. */
export function createGridfsFiles(sessionId: string, db: string, bucket: string) {
  const coll = `${bucket}.files`;

  let rows = $state.raw<GridfsFileRow[]>([]);
  let search = $state("");
  let currentPage = $state(1);
  let pageSize = $state(DEFAULT_PAGE_SIZE);
  let totalCount = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let generation = 0;
  const debouncer = createDebouncer(SEARCH_DEBOUNCE_MS);

  const pageCount = $derived(Math.max(1, Math.ceil(totalCount / pageSize)));

  function filterJson(): string {
    const term = search.trim();
    return term.length === 0
      ? "{}"
      : JSON.stringify({ filename: { $regex: escapeRegexLiteral(term), $options: "i" } });
  }

  async function load() {
    const gen = ++generation;
    loading = true;
    error = null;
    try {
      const filter = filterJson();
      const skip = (currentPage - 1) * pageSize;
      const [docs, count] = await Promise.all([
        queryPage(sessionId, db, coll, skip, pageSize, filter, SORT_BY_UPLOAD_DATE_DESC),
        countDocuments(sessionId, db, coll, filter),
      ]);
      if (gen !== generation) return;
      rows = docs.map(toGridfsFileRow);
      totalCount = count;
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
      rows = [];
    } finally {
      if (gen === generation) loading = false;
    }
  }

  function setSearch(text: string) {
    search = text;
    debouncer.schedule(() => {
      currentPage = 1;
      void load();
    });
  }

  function goToPage(n: number) {
    currentPage = Math.min(Math.max(1, n), pageCount);
    void load();
  }
  function nextPage() {
    goToPage(currentPage + 1);
  }
  function prevPage() {
    goToPage(currentPage - 1);
  }
  function setPageSize(n: number) {
    pageSize = Math.max(1, n);
    currentPage = 1;
    void load();
  }

  void load();

  return {
    get rows() { return rows; },
    get search() { return search; },
    get currentPage() { return currentPage; },
    get pageCount() { return pageCount; },
    get pageSize() { return pageSize; },
    get totalCount() { return totalCount; },
    get loading() { return loading; },
    get error() { return error; },
    setSearch,
    goToPage,
    nextPage,
    prevPage,
    setPageSize,
    refresh: load,
  };
}

export type GridfsFiles = ReturnType<typeof createGridfsFiles>;
