import * as m from "#lib/paraglide/messages.js";
import { countDocuments, updateMany, deleteMany } from "../api/documents";
import { errorMessage } from "../api/errors";
import { idInFilter } from "../domain/selection";
import { parseUpdateDoc, isEmptyFilter } from "../domain/bulk";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";
import { countCmd, updateManyCmd, deleteManyCmd } from "../domain/mongosh";
import type { DestructiveGate } from "./destructiveGate.svelte";

/** Bulk update/delete flow (dialog state, count, run) for one collection view. */
export function createCollectionBulk(opts: {
  sessionId: string;
  db: string;
  coll: string;
  getAppliedFilter: () => string;
  getSelectedIds: () => { ids: string[] } | { missing: true };
  reload: () => Promise<void>;
  gate: DestructiveGate;
}) {
  const { sessionId, db, coll, getAppliedFilter, getSelectedIds, reload, gate } = opts;

  let bulkMode = $state<"update" | "delete" | null>(null);
  let bulkUpdateText = $state("");
  let bulkUpdateError = $state<string | null>(null);
  let bulkCount = $state<number | null>(null);
  let bulkCounting = $state(false);
  let bulkRunning = $state(false);
  let bulkScope = $state<"filter" | "selection">("filter");
  let bulkFilter = $state("{}");
  let bulkResult = $state<string | null>(null);
  let bulkError = $state<string | null>(null);
  // The count failed / timed out: running is still allowed, but only with type-to-confirm (spec §2.2).
  let bulkCountFailed = $state(false);

  const canRunBulk = $derived(
    !bulkRunning && (bulkScope === "selection" || bulkCount !== null || bulkCountFailed),
  );

  function openBulk(mode: "update" | "delete", scope: "filter" | "selection" = "filter") {
    bulkMode = mode;
    bulkScope = scope;
    bulkUpdateText = "";
    bulkUpdateError = null;
    bulkResult = null;
    bulkError = null;
    bulkCountFailed = false;
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
  }

  async function countBulk() {
    bulkCounting = true;
    bulkError = null;
    bulkResult = null;
    activity.begin(m.common_running());
    try {
      bulkCount = await commandLog.pushTimed(countCmd(coll, bulkFilter), sessionId, () =>
        countDocuments(sessionId, db, coll, bulkFilter, settings.queryTimeoutMs));
    } catch (e) {
      bulkError = errorMessage(e);
      bulkCount = null;
      bulkCountFailed = true;
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

  /** The bulk dialog (with its count) is the plain confirmation; the gate only steps in when typing
   *  the name is required — PROD, or an empty filter that matches every document. */
  async function runBulk() {
    if (!bulkMode) return;
    // Validate the update before asking anyone to type a name.
    if (bulkMode === "update") {
      const r = parseUpdateDoc(bulkUpdateText);
      if (!r.ok) {
        bulkUpdateError = r.error;
        return;
      }
    }
    const all = bulkScope === "filter" && isEmptyFilter(bulkFilter);
    const filter = bulkFilter;
    await gate.request(
      { op: bulkMode === "delete" ? "deleteMany" : "updateMany", target: { db, coll }, count: bulkCount, forceType: all, skipConfirm: true },
      () => performBulk(filter, all),
    );
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
    get bulkResult() { return bulkResult; },
    get bulkError() { return bulkError; },
    get canRunBulk() { return canRunBulk; },
    openBulk,
    closeBulk,
    countBulk,
    runBulk,
  };
}
