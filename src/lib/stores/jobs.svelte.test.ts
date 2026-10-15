import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync } from "svelte";
import { createJobs, type JobState } from "./jobs.svelte";
import { toast } from "./toast.svelte";

function fakeJob(label = "Exporting orders") {
  let state = $state<JobState>("running");
  let pct = $state<number | null>(10);
  const cancel = vi.fn(() => { state = "cancelled"; });
  return {
    src: { kind: "export" as const, label, progress: () => pct, state: () => state, cancel, summary: () => "Exported 48,213 documents" },
    set(s: JobState, p: number | null = pct) { state = s; pct = p; },
    cancel,
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe("jobs", () => {
  it("registers a running job and counts it", () => {
    const jobs = createJobs();
    const j = fakeJob();
    jobs.register(j.src);
    expect(jobs.list).toHaveLength(1);
    expect(jobs.running).toBe(1);
  });

  it("cancel calls the job's cancel", () => {
    const jobs = createJobs();
    const j = fakeJob();
    const id = jobs.register(j.src);
    jobs.cancel(id);
    expect(j.cancel).toHaveBeenCalled();
  });

  it("finishing toasts the summary and prunes the job after 60 s", () => {
    vi.useFakeTimers();
    const jobs = createJobs();
    const j = fakeJob();
    jobs.register(j.src);
    j.set("done", 100);
    flushSync();
    expect(toast.toasts.at(-1)?.message).toBe("Exported 48,213 documents");
    expect(jobs.running).toBe(0);
    expect(jobs.list).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(jobs.list).toHaveLength(0);
  });

  it("a failure shows an error toast", () => {
    const jobs = createJobs();
    const j = fakeJob("Importing into shop.orders");
    jobs.register({ ...j.src, summary: undefined });
    j.set("failed");
    flushSync();
    expect(toast.toasts.at(-1)).toMatchObject({ kind: "error" });
  });
});

describe("job adapters", () => {
  it("export: progress from the overall percent, cancel marks cancelled", async () => {
    const { exportJobSource } = await import("./jobs.svelte");
    const job = { running: true, done: false, overall: { percent: 45 }, succeeded: 0, failed: 0, cancel: vi.fn() };
    const s = exportJobSource(job, "orders.json");
    expect(s.label).toBe("Exporting orders.json");
    expect(s.progress()).toBe(45);
    expect(s.state()).toBe("running");
    s.cancel!();
    job.done = true;
    expect(job.cancel).toHaveBeenCalled();
    expect(s.state()).toBe("cancelled");
  });

  it("sql/csv: back to config with an error = failed", async () => {
    const { phaseJobSource } = await import("./jobs.svelte");
    const job = { phase: "running", progress: { done: 5, total: 10 }, error: null as string | null };
    const s = phaseJobSource(job, "shop.users");
    expect(s.progress()).toBe(50);
    job.phase = "config";
    job.error = "boom";
    expect(s.state()).toBe("failed");
  });

  it("export: cancelled from the wizard or partially failed is not a success", async () => {
    const { exportJobSource } = await import("./jobs.svelte");
    const job = { running: false, done: true, cancelled: true, overall: { percent: 50 }, succeeded: 2, failed: 0, cancel: vi.fn() };
    expect(exportJobSource(job, "x").state()).toBe("cancelled");
    expect(exportJobSource({ ...job, cancelled: false, failed: 1 }, "x").state()).toBe("failed");
  });
});
