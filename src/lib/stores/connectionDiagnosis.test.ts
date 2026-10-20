import { describe, it, expect, vi } from "vitest";
import { createConnectionDiagnosis } from "./connectionDiagnosis.svelte";

const ok = { step: "parse", ok: true, ms: 1, detail: "" };
const bad = { step: "dns", ok: false, ms: 2, detail: "x: failed to lookup address" };

describe("createConnectionDiagnosis", () => {
  it("collects the steps and reports the failed one", async () => {
    const d = createConnectionDiagnosis(vi.fn().mockResolvedValue([ok, bad]));
    expect(d.finished).toBe(false);
    await d.start();
    expect(d.steps).toHaveLength(2);
    expect(d.verdict?.step).toBe("dns");
    expect(d.finished).toBe(true);
    expect(d.running).toBe(false);
  });

  it("surfaces a command failure instead of throwing", async () => {
    const d = createConnectionDiagnosis(vi.fn().mockRejectedValue({ kind: "Io", message: "boom" }));
    await d.start();
    expect(d.error).toContain("boom");
    expect(d.steps).toEqual([]);
  });

  it("ignores a second start while one is running", async () => {
    const run = vi.fn().mockResolvedValue([ok]);
    const d = createConnectionDiagnosis(run);
    const p = d.start();
    await d.start();
    await p;
    expect(run).toHaveBeenCalledTimes(1);
  });
});
