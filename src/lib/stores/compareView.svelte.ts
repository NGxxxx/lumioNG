// src/lib/stores/compareView.svelte.ts — state + actions of a Compare tab: pick two collections (any
// sessions), compare them in Rust, browse the differences, dry-run and then apply a sync.
// Safety: the written side follows the direction; a real sync needs a dry run of the exact current
// plan and goes through the destructive gate (typed name on PROD). Rust re-checks all of it.
import { compareStart, comparePage, compareCancel, compareDispose, syncApply, type CompareProgress, type DiffRow } from "../api/compare";
import { errorMessage } from "../api/errors";
import {
  parseFieldList, planKey, plannedTotal, rowChanges, sameNamespace, syncEnds,
  type DiffKind, type DiffSummary, type Direction, type NsRef, type SyncPlan, type SyncReport,
} from "../domain/compare";
import type { Environment } from "../domain/environment";
import { createDestructiveGate } from "./destructiveGate.svelte";
import * as m from "#lib/paraglide/messages.js";

export const PAGE_SIZE = 50;

export type SessionLookup = (id: string) => { label: string; environment: Environment; readOnly: boolean } | undefined;
export type ListKind = Exclude<DiffKind, "same">;

export function createCompareView(args: { tabId: number; src: NsRef; sessionInfo: SessionLookup }) {
  const compareId = `compare-${args.tabId}`;
  const src = $state<NsRef>({ ...args.src });
  const dst = $state<NsRef>({ sessionId: args.src.sessionId, db: args.src.db, coll: "" });
  let key = $state("_id");
  let filterText = $state("");
  let ignoreText = $state("");
  let insertMissing = $state(true);
  let replaceDifferent = $state(true);
  let deleteExtra = $state(false);
  let direction = $state<Direction>("srcToDst");

  let comparing = $state(false);
  let progress = $state<CompareProgress | null>(null);
  let summary = $state<DiffSummary | null>(null);
  let error = $state<string | null>(null);
  let kind = $state<ListKind>("different");
  let page = $state(0);
  let rows = $state.raw<DiffRow[]>([]);
  let total = $state(0);
  let selected = $state(0);
  let loadingPage = $state(false);

  let dryRunMark = $state.raw<{ key: string; report: SyncReport } | null>(null);
  let syncing = $state<"dry" | "apply" | null>(null);
  let syncProgress = $state<CompareProgress | null>(null);
  let syncReport = $state.raw<SyncReport | null>(null);
  let syncError = $state<string | null>(null);

  const info = (id: string) => args.sessionInfo(id);
  const plan = $derived<SyncPlan>({
    src: { ...src }, dst: { ...dst }, key: key.trim() || "_id",
    filter: filterText.trim() === "" ? null : filterText,
    ignoreFields: parseFieldList(ignoreText),
    insertMissing, replaceDifferent, deleteExtra, direction,
  });
  const ends = $derived(syncEnds(plan));
  const targetEnv = $derived<Environment>(info(ends.to.sessionId)?.environment ?? "");
  const targetReadOnly = $derived(info(ends.to.sessionId)?.readOnly ?? false);
  const dryRunReport = $derived(dryRunMark && dryRunMark.key === planKey(plan) ? dryRunMark.report : null);
  const canApply = $derived(
    dryRunReport !== null && !dryRunReport.cancelled && plannedTotal(dryRunReport) > 0 && !targetReadOnly && syncing === null && !comparing,
  );
  const selectedRow = $derived(rows[selected] ?? null);
  const changes = $derived(selectedRow ? rowChanges(selectedRow, direction) : []);

  const gate = createDestructiveGate(() => targetEnv);

  function sidesError(): string | null {
    if (![src.db, src.coll, dst.db, dst.coll].every((s) => s.trim() !== "") || !info(src.sessionId) || !info(dst.sessionId)) return m.compare_err_pick_sides();
    if (sameNamespace(src, dst)) return m.compare_err_same();
    return null;
  }

  async function loadPage() {
    if (!summary) return;
    loadingPage = true;
    try {
      const res = await comparePage(compareId, kind, page * PAGE_SIZE, PAGE_SIZE);
      rows = res.rows;
      total = res.total;
      selected = 0;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loadingPage = false;
    }
  }

  async function compare() {
    const bad = sidesError();
    error = bad;
    if (bad || comparing) return;
    const p = plan;
    comparing = true;
    progress = null;
    summary = null;
    rows = [];
    total = 0;
    try {
      summary = await compareStart(compareId, p.src, p.dst, p.key, p.filter, p.ignoreFields, (pr) => (progress = pr));
      const s = summary;
      kind = s.different > 0 ? "different" : s.onlySrc > 0 ? "onlySrc" : s.onlyDst > 0 ? "onlyDst" : "different";
      page = 0;
      await loadPage();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      comparing = false;
    }
  }

  async function showKind(k: ListKind) {
    kind = k;
    page = 0;
    await loadPage();
  }

  async function goPage(delta: number) {
    const next = page + delta;
    if (next < 0 || next * PAGE_SIZE >= total) return;
    page = next;
    await loadPage();
  }

  async function cancel() {
    await compareCancel(compareId);
  }

  async function dryRun() {
    const bad = sidesError() ?? (targetReadOnly ? m.compare_err_read_only() : null);
    syncError = bad;
    if (bad || syncing) return;
    const p = plan;
    const k = planKey(p);
    syncing = "dry";
    syncProgress = null;
    try {
      const report = await syncApply(compareId, p, true, false, (pr) => (syncProgress = pr));
      dryRunMark = { key: k, report };
    } catch (e) {
      syncError = errorMessage(e);
    } finally {
      syncing = null;
    }
  }

  function directionText(from: NsRef, to: NsRef): string {
    const side = (n: NsRef) => `${info(n.sessionId)?.label ?? n.sessionId} ${n.db}.${n.coll}`;
    return `${side(from)} → ${side(to)}`;
  }

  /** The real sync, run only by the gate after the user confirmed; `confirmed` is true for that reason alone. */
  async function apply(p: SyncPlan, k: string) {
    if (planKey(plan) !== k) throw new Error(m.compare_err_plan_changed());
    syncing = "apply";
    syncProgress = null;
    syncError = null;
    try {
      syncReport = await syncApply(compareId, p, false, true, (pr) => (syncProgress = pr));
      dryRunMark = null;
    } catch (e) {
      syncError = errorMessage(e);
      dryRunMark = null; // Rust consumed (or rejected) it; a new dry run is needed either way
      throw e;
    } finally {
      syncing = null;
    }
  }

  async function requestApply() {
    const report = dryRunReport;
    if (!canApply || !report) return;
    const p = plan;
    const k = planKey(p);
    const { from, to } = syncEnds(p);
    const env = targetEnv;
    await gate.request(
      {
        op: "sync",
        target: {
          db: to.db, coll: to.coll,
          detail: `${directionText(from, to)} · ${m.compare_dry_result({ insert: String(report.planned.insert), replace: String(report.planned.replace), delete: String(report.planned.delete) })}`,
        },
        count: plannedTotal(report), forceType: env === "prod", env,
      },
      () => apply(p, k),
    );
  }

  function swapDirection() {
    direction = direction === "srcToDst" ? "dstToSrc" : "srcToDst";
  }

  function dispose() {
    void compareDispose(compareId).catch(() => {});
  }

  return {
    get src() { return src; },
    get dst() { return dst; },
    get key() { return key; }, set key(v: string) { key = v; },
    get filterText() { return filterText; }, set filterText(v: string) { filterText = v; },
    get ignoreText() { return ignoreText; }, set ignoreText(v: string) { ignoreText = v; },
    get insertMissing() { return insertMissing; }, set insertMissing(v: boolean) { insertMissing = v; },
    get replaceDifferent() { return replaceDifferent; }, set replaceDifferent(v: boolean) { replaceDifferent = v; },
    get deleteExtra() { return deleteExtra; }, set deleteExtra(v: boolean) { deleteExtra = v; },
    get direction() { return direction; },
    get comparing() { return comparing; },
    get progress() { return progress; },
    get summary() { return summary; },
    get error() { return error; },
    get kind() { return kind; },
    get page() { return page; },
    get pageCount() { return Math.max(1, Math.ceil(total / PAGE_SIZE)); },
    get rows() { return rows; },
    get total() { return total; },
    get selected() { return selected; },
    get selectedRow() { return selectedRow; },
    get changes() { return changes; },
    get loadingPage() { return loadingPage; },
    get from() { return ends.from; },
    get target() { return ends.to; },
    get targetEnv() { return targetEnv; },
    get targetReadOnly() { return targetReadOnly; },
    get dryRunReport() { return dryRunReport; },
    get canApply() { return canApply; },
    get syncing() { return syncing; },
    get syncProgress() { return syncProgress; },
    get syncReport() { return syncReport; },
    get syncError() { return syncError; },
    gate,
    compare,
    showKind,
    goPage,
    select(i: number) { selected = i; },
    cancel,
    dryRun,
    requestApply,
    swapDirection,
    dispose,
    sessionLabel: (id: string) => info(id)?.label ?? id,
  };
}

export type CompareView = ReturnType<typeof createCompareView>;
