// src/lib/stores/jobs.svelte.ts — registry of import / export jobs that keep running after their
// dialog closes; feeds the status-bar indicator, toasts on completion, prunes finished jobs.
import { untrack } from "svelte";
import { toast } from "./toast.svelte";
import * as m from "#lib/paraglide/messages.js";

export type JobState = "running" | "done" | "failed" | "cancelled";

/** What a running job exposes; getters are read reactively (the job objects are rune stores). */
export type JobSource = {
  kind: "import" | "export";
  label: string;
  /** 0–100, or null when unknown. */
  progress: () => number | null;
  state: () => JobState;
  cancel?: () => void;
  /** Completion message (defaults to "<label>: Done"). */
  summary?: () => string;
  /** Per-target lines for the popover's Details (e.g. each exported collection). */
  details?: () => { label: string; state: string }[];
};

export type JobEntry = { id: number; source: JobSource; finishedAt: number | null };

export const KEEP_FINISHED_MS = 60_000;

export function createJobs() {
  let list = $state.raw<JobEntry[]>([]);
  let nextId = 1;

  function patch(id: number, p: Partial<JobEntry>) {
    list = list.map((j) => (j.id === id ? { ...j, ...p } : j));
  }

  function dismiss(id: number) {
    list = list.filter((j) => j.id !== id);
  }

  function finished(id: number, source: JobSource, state: JobState) {
    patch(id, { finishedAt: Date.now() });
    if (state === "failed") toast.push(m.jobs_failed_toast({ label: source.label }), "error", 6000);
    else if (state === "done") toast.push(source.summary?.() ?? `${source.label}: ${m.jobs_state_done()}`, "success", 5000);
    setTimeout(() => dismiss(id), KEEP_FINISHED_MS);
  }

  function register(source: JobSource): number {
    const id = nextId++;
    list = [...list, { id, source, finishedAt: null }];
    // Watch only the job's own state (everything else untracked); stop once it leaves "running".
    let done = false;
    const stop = $effect.root(() => {
      $effect(() => {
        const s = source.state();
        if (s === "running" || done) return;
        done = true;
        untrack(() => finished(id, source, s));
        queueMicrotask(() => stop());
      });
    });
    return id;
  }

  function cancel(id: number) {
    list.find((j) => j.id === id)?.source.cancel?.();
  }

  return {
    get list() { return list; },
    /** How many jobs are still running. */
    get running() { return list.filter((j) => j.finishedAt === null).length; },
    register,
    cancel,
    dismiss,
  };
}

/** App-wide singleton. */
export const jobs = createJobs();

/** Short name of what an export writes: one namespace, "N collections", or the file's name. */
export function exportTargetLabel(targets: { db: string; coll: string }[] | null, filePath: string | null): string {
  if (targets && targets.length === 1) return targets[0].db ? `${targets[0].db}.${targets[0].coll}` : targets[0].coll;
  if (targets && targets.length > 1) return m.jobs_collections({ count: String(targets.length) });
  return filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : "";
}

// ── Adapters: the existing job stores → JobSource ──

/** An export job (stores/exportJob). */
export function exportJobSource(
  job: {
    running: boolean; done: boolean; cancelled?: boolean; overall: { percent: number | null }; succeeded: number; failed: number; cancel: () => void;
    rows?: { db: string; coll: string; status: string }[];
  },
  target: string,
): JobSource {
  let cancelled = false; // also set when cancelled from the indicator before the job reports it
  return {
    kind: "export",
    label: m.jobs_export_label({ target }),
    progress: () => job.overall.percent,
    state: () => {
      if (!job.done) return "running";
      if (cancelled || job.cancelled) return "cancelled";
      return job.failed > 0 ? "failed" : "done";
    },
    cancel: () => { cancelled = true; job.cancel(); },
    summary: () => m.jobs_export_finished({ ok: String(job.succeeded), fail: String(job.failed) }),
    details: job.rows ? () => (job.rows ?? []).map((r) => ({ label: r.db ? `${r.db}.${r.coll}` : r.coll, state: r.status })) : undefined,
  };
}

/** A JSON / BSON import job (stores/importJob). */
export function importJobSource(job: { done: number; total: number; finished: boolean; error: string | null }, target: string): JobSource {
  return {
    kind: "import",
    label: m.jobs_import_label({ target }),
    progress: () => (job.total > 0 ? Math.min(100, (job.done / job.total) * 100) : null),
    state: () => (!job.finished ? "running" : job.error ? "failed" : "done"),
    summary: () => m.jobs_import_finished({ target }),
  };
}

/** A SQL / CSV import (stores/sqlImport, csvImport): phase "running" → "done", or back to config on error. */
export function phaseJobSource(
  job: { phase: string; progress: { done: number; total: number } | null; error: string | null; cancelled?: boolean; cancel?: () => void },
  target: string,
): JobSource {
  return {
    kind: "import",
    label: m.jobs_import_label({ target }),
    progress: () => (job.progress && job.progress.total > 0 ? Math.min(100, (job.progress.done / job.progress.total) * 100) : null),
    state: () => {
      if (job.phase === "running") return "running";
      if (job.phase === "done") return job.cancelled ? "cancelled" : "done";
      return job.error ? "failed" : "done";
    },
    cancel: job.cancel ? () => job.cancel!() : undefined,
    summary: () => m.jobs_import_finished({ target }),
  };
}
