import { deleteMany, fetchFullDoc } from "../api/documents";
import { getByPath } from "../domain/schema";
import { clampPage, pageCount } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { idJson } from "../domain/docid";
import { clipboardTextOf } from "../domain/extjson";
import { isInlineEditable, isModalEditable } from "../domain/celledit";
import { errorMessage } from "../api/errors";
import { deleteManyCmd, findOneByIdCmd } from "../domain/mongosh";
import { idInFilter } from "../domain/selection";
import { toJsonArray, toCsv } from "../domain/exporter";
import type { ExportWizardInput } from "../domain/exportPlan";
import type { MenuItem } from "../domain/gridView";
import * as m from "#lib/paraglide/messages.js";
import { commandLog } from "./commandLog.svelte";
import { createClipboardCopy } from "./clipboardCopy";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { UNDO_DELETE_CAP, snapshotForUndo, recordDelete } from "./documentWrites";
import type { createRowSelection } from "./rowSelection.svelte";
import type { ScriptResult } from "./scriptResult.svelte";
import type { createScriptRun } from "./scriptRun.svelte";

/** What the result-grid block needs from the owning query tab (all read lazily). */
export interface ScriptResultGridCtx {
  getSessionId: () => string;
  result: ScriptResult;
  selection: ReturnType<typeof createRowSelection>;
  getRun: () => ReturnType<typeof createScriptRun>;
  startEdit: (row: number, key: string) => void;
  clearEdit: () => void;
}

/** Selection-driven actions of a Query tab's result grid: context menu, delete, export, and the
 *  activeDataView bridge helpers. */
export function createScriptResultGrid(ctx: ScriptResultGridCtx) {
  const r = ctx.result;
  const selection = ctx.selection;
  // Selection deletes confirm through the environment policy (sessionId is read fresh: it can be rebound).
  const destructive = createDestructiveGate(() => sessionEnvironment(ctx.getSessionId()));
  let exportRequest = $state.raw<{ rows: Doc[] } | null>(null);

  function menuItems(): MenuItem[] {
    const menu = selection.menu;
    if (!menu) return [];
    const doc = r.docs[menu.row];
    const n = selection.effectiveRows().length;
    const hasId = doc ? idJson(doc) !== null : false;
    const editable = r.isEditable();
    const allHaveId = selection.effectiveRows().every((i) => { const d = r.docs[i]; return d ? idJson(d) !== null : false; });
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: m.context_menu_open_document(), action: "open", disabled: !hasId || n !== 1 });
    }
    if (menu.source === "tree") items.push({ label: m.context_menu_expand_full_depth(), action: "expandFullDepth" });
    items.push({ label: m.context_menu_refresh(), action: "refresh", disabled: !r.recipe });
    if (editable) {
      items.push({
        label: m.context_menu_edit_cell(), action: "editCell",
        disabled: !doc || idJson(doc) === null
          || (!isInlineEditable(menu.key, getByPath(doc, menu.key)) && !isModalEditable(menu.key, getByPath(doc, menu.key))),
      });
    }
    const copyChildren: MenuItem[] = [
      { label: m.context_menu_copy_value(), action: "copyValue" },
      { label: m.context_menu_copy_field_path(), action: "copyPath" },
      { label: m.context_menu_copy_id(), action: "copyId", disabled: !hasId },
      { label: m.context_menu_copy_selected_json({ count: n }), action: "copyJson" },
      { label: m.context_menu_copy_selected_csv({ count: n }), action: "copyCsv" },
    ];
    if (editable) {
      items.push({ label: m.context_menu_copy(), action: "copy", children: copyChildren });
    } else {
      items.push(...copyChildren);
    }
    items.push({ label: m.context_menu_export(), action: "export", children: [
      { label: m.context_menu_export_selected({ count: n }), action: "exportSelected" },
      { label: m.context_menu_export_all_results(), action: "exportAll" },
    ]});
    if (editable) {
      items.push({ label: m.context_menu_delete_selected_n({ count: n }), action: "deleteSelected", disabled: !allHaveId });
    }
    return items;
  }

  const copy = createClipboardCopy((msg) => { r.ioError = msg; });

  function onMenuSelect(action: string): { open: Doc } | { expandFullDepth: number } | null {
    const menu = selection.menu;
    if (!menu) return null;
    const doc = r.docs[menu.row];
    const key = menu.key;
    const rows = selection.effectiveRows();
    const picked = rows.map((i) => r.docs[i]).filter(Boolean) as Doc[];
    switch (action) {
      case "open": selection.closeMenu(); return doc ? { open: doc } : null;
      case "expandFullDepth": { const row = menu.row; selection.closeMenu(); return { expandFullDepth: row }; }
      case "refresh": ctx.getRun().refreshResults(); break;
      case "editCell": { const row = menu.row; const k = menu.key; selection.closeMenu(); ctx.startEdit(row, k); return null; }
      case "copyValue": copy(clipboardTextOf(getByPath(doc, key))); break;
      case "copyPath": copy(key); break;
      case "copyId": copy(idJson(doc) ?? ""); break;
      case "copyJson": copy(toJsonArray(picked)); break;
      case "copyCsv": copy(toCsv(picked)); break;
      case "exportSelected": exportRequest = { rows: picked }; break;
      case "exportAll": exportRequest = { rows: r.docs }; break;
      case "deleteSelected": requestDelete(picked); break;
    }
    selection.closeMenu();
    return null;
  }

  function requestDelete(picked: Doc[]) {
    if (picked.length === 0 || !r.provenance) return;
    void destructive.request(
      { op: "deleteMany", target: { db: r.provenance.db, coll: r.provenance.coll }, count: picked.length, undoable: picked.length <= UNDO_DELETE_CAP },
      () => deleteSelected(picked),
    );
  }

  // ── activeDataView bridge: mirrors ResultTable's DataViewHandle shape, backed by `selected`/`docs` instead of collectionView's selection/paging state. ──

  /** The single selected row's doc, editable only when the result is a live grid-editable
   *  cursor (has a real db/coll `provenance`) and the doc carries an `_id`. */
  function getSelectedForEdit(): Doc | null {
    if (!r.isEditable() || selection.selected.size !== 1) return null;
    const d = r.docs[[...selection.selected][0]];
    return d && idJson(d) !== null ? d : null;
  }

  function requestDeleteSelected() {
    if (!r.isEditable()) return;
    const picked = [...selection.selected].map((i) => r.docs[i]).filter(Boolean) as Doc[];
    requestDelete(picked);
  }

  /** Exports the selection if any, else every currently loaded row (matches the "Export" ->
   *  "All results" context-menu action). */
  function requestExportCurrent() {
    const picked = [...selection.selected].map((i) => r.docs[i]).filter(Boolean) as Doc[];
    exportRequest = { rows: picked.length > 0 ? picked : r.docs };
  }

  async function deleteSelected(picked: Doc[]) {
    if (!r.provenance) return;
    const prov = r.provenance;
    const ids: string[] = [];
    for (const d of picked) {
      const id = idJson(d);
      if (id === null) { r.ioError = m.query_run_selection_missing_id(); return; }
      ids.push(id);
    }
    const filter = idInFilter(ids);
    r.loading = true;
    try {
      const snapshot = await snapshotForUndo(ctx.getSessionId(), prov.db, prov.coll, ids);
      await commandLog.pushTimed(deleteManyCmd(prov.coll, filter), ctx.getSessionId(), () =>
        deleteMany(ctx.getSessionId(), prov.db, prov.coll, filter, false));
      recordDelete(ctx.getSessionId(), prov.db, prov.coll, snapshot);
      selection.clearSelection();
      ctx.clearEdit();
      if (r.recipe) {
        const rc = r.recipe;
        const gen = r.bumpGeneration();
        if (rc.fixedLimit === null) {
          const total = await ctx.getRun().countPaged(rc);
          if (gen !== r.generation) return;
          r.totalCount = total;
          r.pageReq = clampPage(r.page, pageCount(r.totalCount, r.pageSize));
        }
        await ctx.getRun().loadPagedCurrentPage();
      } else {
        r.fullDocs = r.fullDocs.filter((d) => { const id = idJson(d); return id === null || !ids.includes(id); });
        r.totalCount = r.fullDocs.length;
        r.docs = r.showingAll
          ? r.fullDocs
          : r.fullDocs.slice((r.page - 1) * r.pageSize, (r.page - 1) * r.pageSize + r.pageSize);
      }
    } catch (e) {
      r.ioError = errorMessage(e);
    } finally {
      r.loading = false;
    }
  }

  function cancelExport() { exportRequest = null; }

  function exportInput(): ExportWizardInput | null {
    if (!exportRequest) return null;
    const colPaths = r.rawColumnFields.map((c) => ({ path: c.path, visible: true, type: c.type }));
    const n = exportRequest.rows.length;
    return {
      mode: "scopedMemory",
      coll: r.provenance?.coll ?? "results",
      docs: exportRequest.rows,
      columns: colPaths,
      summary: n === 1
        ? m.export_dialog_summary_selection_one({ count: n })
        : m.export_dialog_summary_selection_many({ count: n }),
    };
  }

  /** The whole document for a result row: re-fetched from the source collection when the result has
   *  one (a find() may be projected — editing a partial copy would wipe the other fields on save). */
  async function fullDocFor(d: Doc): Promise<Doc> {
    const id = idJson(d);
    if (!r.provenance || id === null) return d;
    const { db, coll } = r.provenance;
    const full = await commandLog.pushTimed(findOneByIdCmd(coll, id), ctx.getSessionId(), () => fetchFullDoc(ctx.getSessionId(), db, coll, id));
    return full ?? d;
  }

  /** Replaces the result row holding the same `_id` (after a save from the quick-look drawer). */
  function replaceDoc(saved: Doc) {
    const id = idJson(saved);
    if (id === null) return;
    const swap = (list: Doc[]) => list.map((d) => (idJson(d) === id ? saved : d));
    r.fullDocs = swap(r.fullDocs);
    r.docs = swap(r.docs);
  }

  return {
    get destructive() { return destructive; },
    get exportRequest() { return exportRequest; },
    get canEditSelected() { return getSelectedForEdit() !== null; },
    get canDeleteSelected() {
      return r.isEditable() && selection.selected.size > 0 &&
        [...selection.selected].every((i) => { const d = r.docs[i]; return d ? idJson(d) !== null : false; });
    },
    copy,
    menuItems,
    onMenuSelect,
    getSelectedForEdit,
    requestDeleteSelected,
    requestExportCurrent,
    cancelExport,
    exportInput,
    fullDocFor,
    replaceDoc,
  };
}
