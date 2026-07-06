import * as m from "$lib/paraglide/messages";
import { countDocuments, updateMany, deleteMany } from "../api/documents";
import { errorMessage } from "../api/errors";
import { idInFilter } from "../domain/selection";
import { parseUpdateDoc, isEmptyFilter } from "../domain/bulk";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { countCmd, updateManyCmd, deleteManyCmd } from "../domain/mongosh";

/** Bulk update/delete flow (dialog state, count, run) for one collection view. */
export function createCollectionBulk(opts: {
  sessionId: string;
  db: string;
  coll: string;
  getAppliedFilter: () => string;
  getSelectedIds: () => { ids: string[] } | { missing: true };
  reload: () => Promise<void>;
}) {
  const { sessionId, db, coll, getAppliedFilter, getSelectedIds, reload } = opts;

  let bulkMode = $state<"update" | "delete" | null>(null);
  let bulkUpdateText = $state("");
  let bulkUpdateError = $state<string | null>(null);
  let bulkCount = $state<number | null>(null);
  let bulkCounting = $state(false);
  let bulkRunning = $state(false);
  let bulkScope = $state<"filter" | "selection">("filter");
  let bulkFilter = $state("{}");
  let bulkTypeConfirm = $state(false);
  let bulkResult = $state<string | null>(null);
  let bulkError = $state<string | null>(null);

  const canRunBulk = $derived(
    !bulkRunning && (bulkScope === "selection" || bulkCount !== null),
  );

  function openBulk(mode: "update" | "delete", scope: "filter" | "selection" = "filter") {
    bulkMode = mode;
    bulkScope = scope;
    bulkUpdateText = "";
    bulkUpdateError = null;
    bulkResult = null;
    bulkError = null;
    bulkTypeConfirm = false;
    if (scope === "selection") {
      const sel = getSelectedIds();
      if ("missing" in sel) {
        bulkFilter = "";
        bulkCount = null;
        bulkError = m.collection_view_selection_missing_id();
        return;
      }
      bulkFilter = idInFilter(sel.ids);
      bulkCount = sel.ids.length;
    } else {
      bulkFilter = getAppliedFilter();
      bulkCount = null;
    }
  }

  function closeBulk() {
    bulkMode = null;
    bulkTypeConfirm = false;
  }

  async function countBulk() {
    bulkCounting = true;
    bulkError = null;
    bulkResult = null;
    activity.begin(m.common_running());
    try {
      bulkCount = await commandLog.pushTimed(countCmd(coll, bulkFilter), sessionId, () =>
        countDocuments(sessionId, db, coll, bulkFilter));
    } catch (e) {
      bulkError = errorMessage(e);
    } finally {
      bulkCounting = false;
      activity.end();
    }
  }

  async function performBulk(filter: string, allowAll: boolean) {
    bulkError = null;
    bulkResult = null;
    if (bulkMode === "update") {
      const r = parseUpdateDoc(bulkUpdateText);
      if (!r.ok) {
        bulkUpdateError = r.error;
        return;
      }
      bulkUpdateError = null;
      bulkRunning = true;
      activity.begin(m.common_running());
      try {
        const res = await commandLog.pushTimed(updateManyCmd(coll, filter, r.json), sessionId, () =>
          updateMany(sessionId, db, coll, filter, r.json, allowAll));
        bulkResult = m.collection_view_bulk_updated({ modified: res.modified, matched: res.matched });
        await reload();
        bulkCount = null;
      } catch (e) {
        bulkError = errorMessage(e);
      } finally {
        bulkRunning = false;
        activity.end();
      }
    } else if (bulkMode === "delete") {
      bulkRunning = true;
      activity.begin(m.common_running());
      try {
        const n = await commandLog.pushTimed(deleteManyCmd(coll, filter), sessionId, () =>
          deleteMany(sessionId, db, coll, filter, allowAll));
        bulkResult = m.collection_view_bulk_deleted({ n });
        await reload();
        bulkCount = null;
      } catch (e) {
        bulkError = errorMessage(e);
      } finally {
        bulkRunning = false;
        activity.end();
      }
    }
  }

  async function runBulk() {
    if (bulkScope === "filter" && isEmptyFilter(bulkFilter)) {
      bulkTypeConfirm = true;
      return;
    }
    await performBulk(bulkFilter, false);
  }

  async function confirmBulkAll() {
    bulkTypeConfirm = false;
    await performBulk(bulkFilter, true);
  }

  function cancelBulkAll() {
    bulkTypeConfirm = false;
  }

  return {
    get bulkMode() { return bulkMode; },
    get bulkUpdateText() { return bulkUpdateText; },
    set bulkUpdateText(v: string) { bulkUpdateText = v; },
    get bulkUpdateError() { return bulkUpdateError; },
    get bulkCount() { return bulkCount; },
    get bulkCounting() { return bulkCounting; },
    get bulkRunning() { return bulkRunning; },
    get bulkScope() { return bulkScope; },
    get bulkTypeConfirm() { return bulkTypeConfirm; },
    get bulkResult() { return bulkResult; },
    get bulkError() { return bulkError; },
    get canRunBulk() { return canRunBulk; },
    openBulk,
    closeBulk,
    countBulk,
    runBulk,
    confirmBulkAll,
    cancelBulkAll,
  };
}
