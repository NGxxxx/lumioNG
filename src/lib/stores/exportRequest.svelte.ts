import * as m from "$lib/paraglide/messages";
import { idInFilter } from "../domain/selection";
import type { ExportWizardInput } from "../domain/exportPlan";
import { buildSort, type SortKey } from "../domain/grid";
import type { ColumnField } from "../domain/schema";

/** Builds the "Export selection" / "Export all (filtered)" wizard input for collectionView's
 *  Data-tab context menu: resolves the effective selection (or the current filter) to a Mongo
 *  filter plus column visibility from the current projection. */
export function createExportRequest(args: {
  db: string;
  coll: string;
  getEffectiveIds: () => { ids: string[] } | { missing: true };
  getEffectiveSelectionCount: () => number;
  getAppliedFilter: () => string;
  getSortKeys: () => SortKey[];
  getRawColumnFields: () => ColumnField[];
  getHidden: () => Set<string>;
}) {
  let ioError = $state<string | null>(null);
  let exportRequest = $state<{ kind: "filter" } | { kind: "selection"; count: number } | null>(null);
  let pendingExportFilter: string | null = "{}";

  function requestExport(scope: "filter" | "selection") {
    if (scope === "selection") {
      const sel = args.getEffectiveIds();
      if ("missing" in sel) {
        ioError = m.collection_view_selection_missing_id();
        return;
      }
      pendingExportFilter = idInFilter(sel.ids);
      exportRequest = { kind: "selection", count: args.getEffectiveSelectionCount() };
    } else {
      pendingExportFilter = args.getAppliedFilter();
      exportRequest = { kind: "filter" };
    }
  }

  function cancelExport() {
    exportRequest = null;
    pendingExportFilter = "{}";
  }

  function exportInput(): ExportWizardInput | null {
    const req = exportRequest;
    if (!req || pendingExportFilter === null) return null; // defensive; requestExport guards the real case
    const hidden = args.getHidden();
    const columns = args.getRawColumnFields().map((c) => ({
      path: c.path,
      visible: !hidden.has(c.path) && ![...hidden].some((h) => c.path.startsWith(h + ".")),
      type: c.type,
    }));
    const filter = pendingExportFilter;
    const sort = req.kind === "filter" ? buildSort(args.getSortKeys()) : null;
    const summary =
      req.kind === "selection"
        ? req.count === 1
          ? m.export_dialog_summary_selection_one({ count: req.count })
          : m.export_dialog_summary_selection_many({ count: req.count })
        : m.export_dialog_summary_filter();
    return { mode: "scopedCollection", db: args.db, coll: args.coll, filter, sort, columns, summary };
  }

  return {
    get ioError() {
      return ioError;
    },
    get exportRequest() {
      return exportRequest;
    },
    requestExport,
    cancelExport,
    exportInput,
  };
}
