import { describe, it, expect } from "vitest";
import { createActivity } from "./activity.svelte";

describe("createActivity", () => {
  it("starts idle (not busy, no label)", () => {
    const a = createActivity();
    expect(a.busy).toBe(false);
    expect(a.label).toBeNull();
  });

  it("begin sets busy + label; end clears when the last op finishes", () => {
    const a = createActivity();
    a.begin("Loading…");
    expect(a.busy).toBe(true);
    expect(a.label).toBe("Loading…");
    a.end();
    expect(a.busy).toBe(false);
    expect(a.label).toBeNull();
  });

  it("ref-counts concurrent ops; label reflects the most recent, stays busy until all end", () => {
    const a = createActivity();
    a.begin("Loading…");
    a.begin("Running query…");
    expect(a.label).toBe("Running query…");
    a.end();
    expect(a.busy).toBe(true); // one op still in flight
    a.end();
    expect(a.busy).toBe(false);
    expect(a.label).toBeNull();
  });

  it("end never drives the count below zero", () => {
    const a = createActivity();
    a.end();
    expect(a.busy).toBe(false);
    a.begin("x");
    expect(a.busy).toBe(true);
  });

  it("track wraps a promise and balances begin/end even on rejection", async () => {
    const a = createActivity();
    const ok = await a.track("work", async () => 42);
    expect(ok).toBe(42);
    expect(a.busy).toBe(false);

    await expect(a.track("boom", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(a.busy).toBe(false);
    expect(a.label).toBeNull();
  });
});
