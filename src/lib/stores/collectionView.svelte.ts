import { queryPage, deleteDocument, replaceDocument } from "../api/documents";
import { errorMessage } from "../api/errors";
import { lastObjectId, idJson } from "../domain/docid";
import { deriveColumnKeys, type Doc } from "../domain/columns";
import { isInlineEditable, editTextOf, rebuildValue } from "../domain/celledit";
import { parseFilter } from "../domain/filter";
import type { MenuItem } from "../components/ContextMenu.svelte";

/**
 * Trạng thái + hành động của một collection view (data, paging, inline edit,
 * context menu, xóa). Component chỉ render và bind; không giữ logic.
 */
export function createCollectionView(db: string, coll: string) {
  let docs = $state<Doc[]>([]);
  let keys = $state<string[]>([]);
  let loading = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);

  let filterText = $state("");
  let filterError = $state<string | null>(null);
  let appliedFilter = $state("{}");
  let generation = 0;

  let confirmDoc = $state<Doc | null>(null);

  // Inline cell edit
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Context menu
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    error = null;
    const gen = generation;
    try {
      const after = lastObjectId(docs);
      if (docs.length > 0 && after === null) {
        done = true;
        error = "Phân trang chỉ hỗ trợ _id kiểu ObjectId trong slice này.";
        return;
      }
      const batch = await queryPage(db, coll, after, 50, appliedFilter);
      if (gen !== generation) return; // superseded by a newer filter
      if (batch.length === 0) {
        done = true;
      } else {
        docs = [...docs, ...batch];
        keys = deriveColumnKeys(docs);
      }
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
    }
  }

  async function applyFilter() {
    const r = parseFilter(filterText);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    appliedFilter = r.json;
    filterError = null;
    generation++; // invalidate any in-flight loadMore
    docs = [];
    keys = [];
    done = false;
    error = null;
    loading = false; // release the guard so the fresh load can start
    await loadMore();
  }

  function startEdit(row: number, key: string) {
    if (!isInlineEditable(key, docs[row][key])) return;
    editing = { row, key };
    editText = editTextOf(docs[row][key]);
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
    const r = rebuildValue(docs[row][key], editText);
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
    const value = docs[menu.row][menu.key];
    return [
      { label: "Open document", action: "open" },
      { label: "Delete document", action: "delete" },
      { label: "Copy value", action: "copyValue" },
      { label: "Copy _id", action: "copyId", disabled: idJson(docs[menu.row]) === null },
      { label: "Edit cell", action: "editCell", disabled: !isInlineEditable(menu.key, value) },
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
        copy(JSON.stringify(doc[key]));
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
    get keys() {
      return keys;
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
    loadMore,
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
  };
}
