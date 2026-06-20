import { queryPage, sampleDocuments, deleteDocument, replaceDocument, fetchFullDoc, countDocuments, updateMany, deleteMany, exportQuery, importDocuments } from "../api/documents";
import { saveDialog, openDialog, writeTextFile } from "../api/files";
import { toJsonArray, toCsv } from "../domain/exporter";
import { errorMessage } from "../api/errors";
import { lastIdJson, idJson } from "../domain/docid";
import { type Doc } from "../domain/columns";
import { getByPath, inferSchema, mergeColumns, type CollectionSchema, type ColumnField } from "../domain/schema";
import { isInlineEditable, editTextOf, rebuildValue } from "../domain/celledit";
import { parseFilter } from "../domain/filter";
import { cycleSort, buildSort, buildProjection, type SortKey } from "../domain/grid";
import { parseUpdateDoc, isEmptyFilter } from "../domain/bulk";
import type { MenuItem } from "../components/ContextMenu.svelte";

/**
 * Trạng thái + hành động của một collection view (data, paging, inline edit,
 * context menu, xóa). Component chỉ render và bind; không giữ logic.
 */
export function createCollectionView(db: string, coll: string) {
  let docs = $state<Doc[]>([]);
  let schema = $state<CollectionSchema | null>(null);
  let loading = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);

  let filterText = $state("");
  let filterError = $state<string | null>(null);
  let appliedFilter = $state("{}");
  let generation = 0;

  let sortKeys = $state<SortKey[]>([]);
  let hidden = $state<Set<string>>(new Set()); // projection đang áp (Task 4 thêm mutator)
  let hiddenDraft = $state<Set<string>>(new Set());
  let pageSize = $state(50);

  const isPristine = $derived(appliedFilter === "{}" && sortKeys.length === 0);

  let confirmDoc = $state<Doc | null>(null);

  // Inline cell edit
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Context menu
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);

  // Bulk operations
  let bulkMode = $state<"update" | "delete" | null>(null);
  let bulkUpdateText = $state("");
  let bulkUpdateError = $state<string | null>(null);
  let bulkCount = $state<number | null>(null);
  let bulkCounting = $state(false);
  let bulkRunning = $state(false);
  let bulkConfirmAll = $state(false);
  let bulkResult = $state<string | null>(null);
  let bulkError = $state<string | null>(null);

  // Export / import I/O
  let ioBusy = $state(false);
  let ioMessage = $state<string | null>(null);
  let ioError = $state<string | null>(null);

  const canRunBulk = $derived(
    bulkCount !== null &&
      !bulkRunning &&
      (!isEmptyFilter(appliedFilter) || bulkConfirmAll),
  );

  const columnFields = $derived(mergeColumns(schema, docs));

  async function loadSchema() {
    const gen = generation;
    try {
      const sample = await sampleDocuments(db, coll, appliedFilter, 100);
      if (gen !== generation) return;
      schema = inferSchema(sample);
    } catch {
      if (gen !== generation) return;
      schema = null; // degrade: cột rơi về row-derived
    }
  }

  async function init() {
    const schemaP = loadSchema();
    await loadMore();
    await schemaP;
  }

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    error = null;
    const gen = generation;
    try {
      let cursor: { afterId: string | null } | { skip: number };
      if (isPristine) {
        const after = lastIdJson(docs);
        if (docs.length > 0 && after === null) {
          done = true;
          error = "document thiếu _id, không phân trang được";
          return;
        }
        cursor = { afterId: after };
      } else {
        cursor = { skip: docs.length };
      }
      const batch = await queryPage(
        db,
        coll,
        cursor,
        pageSize,
        appliedFilter,
        buildSort(sortKeys),
        buildProjection(hidden),
      );
      if (gen !== generation) return; // superseded by a newer filter/sort
      if (batch.length === 0) {
        done = true;
      } else {
        docs = [...docs, ...batch];
      }
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
    }
  }

  /** Reset state phân trang trước khi load lại (không đụng schema). */
  function resetForReload() {
    generation++;
    docs = [];
    done = false;
    error = null;
    loading = false;
  }

  /** Reset kết quả + load lại từ đầu, KHÔNG re-sample schema (cùng filter). */
  async function reloadDocs() {
    resetForReload();
    await loadMore();
  }

  /** Đồng bộ nháp = trạng thái đang áp (gọi khi mở column chooser). */
  function resetProjectionDraft() {
    hiddenDraft = new Set(hidden);
  }

  function toggleHiddenDraft(path: string) {
    const next = new Set(hiddenDraft);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    hiddenDraft = next;
  }

  /** Commit nháp → projection thật + reload. */
  async function applyProjection() {
    hidden = new Set(hiddenDraft);
    await reloadDocs();
  }

  /** Trả nguyên doc đầy đủ field; chỉ re-fetch khi đang ẩn field (projection). */
  async function fullDocFor(d: Doc): Promise<Doc> {
    if (hidden.size === 0) return d;
    const id = idJson(d);
    if (id === null) return d;
    return (await fetchFullDoc(db, coll, id)) ?? d;
  }

  /** Doc đầy đủ để mở tab edit (component tự mở). */
  async function openDoc(d: Doc): Promise<Doc> {
    return await fullDocFor(d);
  }

  async function toggleSort(path: string, shift: boolean) {
    sortKeys = cycleSort(sortKeys, path, shift);
    await reloadDocs();
  }

  async function setPageSize(n: number) {
    pageSize = Math.max(1, Math.floor(n) || 50);
    await reloadDocs();
  }

  async function applyFilter() {
    const r = parseFilter(filterText);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    appliedFilter = r.json;
    filterError = null;
    schema = null;
    resetForReload();
    await init();
  }

  async function startEdit(row: number, key: string) {
    if (key.includes(".")) return; // chưa hỗ trợ sửa inline field lồng nhau
    if (hidden.size > 0) {
      const fullRow = await fullDocFor(docs[row]);
      if (fullRow !== docs[row]) {
        docs[row] = fullRow;
        docs = [...docs];
      }
    }
    const value = getByPath(docs[row], key);
    if (!isInlineEditable(key, value)) return;
    editing = { row, key };
    editText = editTextOf(value);
    editError = null;
  }

  function cancelEdit() {
    if (saving) return;
    editing = null;
    editError = null;
  }

  async function commitEdit() {
    if (!editing || saving) return;
    const { row, key } = editing;
    const r = rebuildValue(getByPath(docs[row], key), editText);
    if (!r.ok) {
      editError = r.error;
      return;
    }
    const newDoc: Doc = { ...docs[row], [key]: r.value };
    const id = idJson(newDoc);
    if (id === null) {
      editError = "Document không có _id để cập nhật.";
      return;
    }
    saving = true;
    try {
      await replaceDocument(db, coll, id, JSON.stringify(newDoc));
      docs[row] = newDoc;
      docs = [...docs];
      editing = null;
      editError = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  function openMenu(e: MouseEvent, row: number, key: string) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, row, key };
  }

  function closeMenu() {
    menu = null;
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const value = getByPath(docs[menu.row], menu.key);
    return [
      { label: "Open document", action: "open" },
      { label: "Delete document", action: "delete" },
      { label: "Copy value", action: "copyValue" },
      { label: "Copy _id", action: "copyId", disabled: idJson(docs[menu.row]) === null },
      { label: "Edit cell", action: "editCell", disabled: menu.key.includes(".") || !isInlineEditable(menu.key, value) },
    ];
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      error = "Không copy được vào clipboard.";
    }
  }

  /** Trả về doc cần mở khi action là "open" (component quyết định mở tab). */
  function onMenuSelect(action: string): { open: Doc } | null {
    if (!menu) return null;
    const row = menu.row;
    const key = menu.key;
    const doc = docs[row];
    menu = null;
    switch (action) {
      case "open":
        return { open: doc };
      case "delete":
        confirmDoc = doc;
        break;
      case "copyValue":
        copy(JSON.stringify(getByPath(doc, key)));
        break;
      case "copyId":
        copy(idJson(doc) ?? "");
        break;
      case "editCell":
        startEdit(row, key);
        break;
    }
    return null;
  }

  function openBulk(mode: "update" | "delete") {
    bulkMode = mode;
    bulkUpdateText = "";
    bulkUpdateError = null;
    bulkCount = null;
    bulkConfirmAll = false;
    bulkResult = null;
    bulkError = null;
  }

  function closeBulk() {
    bulkMode = null;
  }

  async function countBulk() {
    bulkCounting = true;
    bulkError = null;
    bulkResult = null;
    try {
      bulkCount = await countDocuments(db, coll, appliedFilter);
    } catch (e) {
      bulkError = errorMessage(e);
    } finally {
      bulkCounting = false;
    }
  }

  async function runBulk() {
    bulkError = null;
    bulkResult = null;
    const allowAll = isEmptyFilter(appliedFilter) && bulkConfirmAll;
    if (isEmptyFilter(appliedFilter) && !bulkConfirmAll) {
      bulkError = "Filter rỗng: cần tick xác nhận để áp dụng cho toàn bộ collection.";
      return;
    }
    if (bulkMode === "update") {
      const r = parseUpdateDoc(bulkUpdateText);
      if (!r.ok) {
        bulkUpdateError = r.error;
        return;
      }
      bulkUpdateError = null;
      bulkRunning = true;
      try {
        const res = await updateMany(db, coll, appliedFilter, r.json, allowAll);
        bulkResult = `Đã cập nhật ${res.modified} (khớp ${res.matched}) document.`;
        await reloadDocs();
        bulkCount = null;
      } catch (e) {
        bulkError = errorMessage(e);
      } finally {
        bulkRunning = false;
      }
    } else if (bulkMode === "delete") {
      bulkRunning = true;
      try {
        const n = await deleteMany(db, coll, appliedFilter, allowAll);
        bulkResult = `Đã xóa ${n} document.`;
        await reloadDocs();
        bulkCount = null;
      } catch (e) {
        bulkError = errorMessage(e);
      } finally {
        bulkRunning = false;
      }
    }
  }

  async function exportAs(format: "json" | "csv") {
    const path = await saveDialog(`${coll}.${format}`, [
      { name: format.toUpperCase(), extensions: [format] },
    ]);
    if (path === null) return;
    ioBusy = true;
    ioMessage = null;
    ioError = null;
    try {
      const data = await exportQuery(
        db,
        coll,
        appliedFilter,
        buildSort(sortKeys),
        buildProjection(hidden),
      );
      const content = format === "json" ? toJsonArray(data) : toCsv(data);
      await writeTextFile(path, content);
      ioMessage = `Đã export ${data.length} document.`;
    } catch (e) {
      ioError = errorMessage(e);
    } finally {
      ioBusy = false;
    }
  }

  async function importDocs() {
    const path = await openDialog([{ name: "JSON / JSONL", extensions: ["json", "jsonl"] }]);
    if (path === null) return;
    ioBusy = true;
    ioMessage = null;
    ioError = null;
    try {
      const res = await importDocuments(db, coll, path);
      const detail = res.errors.length ? ` ${res.errors.join("; ")}` : "";
      ioMessage = `Đã chèn ${res.inserted}, bỏ qua ${res.failed} lỗi.${detail}`;
      await reloadDocs();
    } catch (e) {
      ioError = errorMessage(e);
    } finally {
      ioBusy = false;
    }
  }

  function requestDelete(doc: Doc) {
    confirmDoc = doc;
  }

  function cancelDelete() {
    confirmDoc = null;
  }

  async function confirmDelete() {
    const d = confirmDoc;
    confirmDoc = null;
    if (!d) return;
    const id = idJson(d);
    if (id === null) {
      error = "Document không có _id để xóa.";
      return;
    }
    try {
      await deleteDocument(db, coll, id);
      docs = docs.filter((x) => x !== d);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  return {
    get docs() {
      return docs;
    },
    get schema() {
      return schema;
    },
    get columnFields() {
      return columnFields;
    },
    get loading() {
      return loading;
    },
    get done() {
      return done;
    },
    get error() {
      return error;
    },
    get filterText() {
      return filterText;
    },
    set filterText(v: string) {
      filterText = v;
    },
    get filterError() {
      return filterError;
    },
    applyFilter,
    get confirmDoc() {
      return confirmDoc;
    },
    get editing() {
      return editing;
    },
    get editText() {
      return editText;
    },
    set editText(v: string) {
      editText = v;
    },
    get editError() {
      return editError;
    },
    get saving() {
      return saving;
    },
    get menu() {
      return menu;
    },
    get sortKeys() {
      return sortKeys;
    },
    get hidden() {
      return hidden;
    },
    get hiddenDraft() {
      return hiddenDraft;
    },
    get pageSize() {
      return pageSize;
    },
    toggleSort,
    setPageSize,
    toggleHiddenDraft,
    applyProjection,
    resetProjectionDraft,
    openDoc,
    loadMore,
    init,
    startEdit,
    cancelEdit,
    commitEdit,
    openMenu,
    closeMenu,
    menuItems,
    onMenuSelect,
    requestDelete,
    cancelDelete,
    confirmDelete,
    copy,
    get appliedFilter() { return appliedFilter; },
    get bulkMode() { return bulkMode; },
    get bulkUpdateText() { return bulkUpdateText; },
    set bulkUpdateText(v: string) { bulkUpdateText = v; },
    get bulkUpdateError() { return bulkUpdateError; },
    get bulkCount() { return bulkCount; },
    get bulkCounting() { return bulkCounting; },
    get bulkRunning() { return bulkRunning; },
    get bulkConfirmAll() { return bulkConfirmAll; },
    set bulkConfirmAll(v: boolean) { bulkConfirmAll = v; },
    get bulkResult() { return bulkResult; },
    get bulkError() { return bulkError; },
    get canRunBulk() { return canRunBulk; },
    openBulk,
    closeBulk,
    countBulk,
    runBulk,
    get ioBusy() { return ioBusy; },
    get ioMessage() { return ioMessage; },
    get ioError() { return ioError; },
    exportAs,
    importDocs,
  };
}
