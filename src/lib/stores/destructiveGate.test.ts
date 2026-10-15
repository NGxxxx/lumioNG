import { describe, it, expect, vi } from "vitest";
import { createDestructiveGate } from "./destructiveGate.svelte";
import type { Environment } from "../domain/environment";

function gate(env: Environment = "dev") {
  return createDestructiveGate(() => env);
}
const T = { db: "shop", coll: "orders" };

describe("destructiveGate", () => {
  it("fetches the count, then sets the level from the policy", async () => {
    const g = gate("dev");
    let resolve!: (n: number) => void;
    const p = g.request({ op: "deleteMany", target: T, fetchCount: () => new Promise<number>((r) => (resolve = r)) }, vi.fn());
    expect(g.pending?.counting).toBe(true);
    resolve(1204);
    await p;
    expect(g.pending).toMatchObject({ counting: false, count: 1204, level: "confirm" });
  });

  it("PROD deleteMany needs typing the collection name", async () => {
    const g = gate("prod");
    await g.request({ op: "deleteMany", target: T, count: 3 }, vi.fn());
    expect(g.pending?.level).toBe("type");
  });

  it("a failed count escalates to type and is flagged", async () => {
    const g = gate("dev");
    await g.request({ op: "deleteMany", target: T, fetchCount: () => Promise.reject(new Error("timeout")) }, vi.fn());
    expect(g.pending).toMatchObject({ count: null, countFailed: true, level: "type" });
  });

  it("a count slower than 5 s times out", async () => {
    vi.useFakeTimers();
    try {
      const g = gate("dev");
      const p = g.request({ op: "updateMany", target: T, fetchCount: () => new Promise<number>(() => {}) }, vi.fn());
      await vi.advanceTimersByTimeAsync(5001);
      await p;
      expect(g.pending).toMatchObject({ countFailed: true, level: "type" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirm runs the action and clears; a failure keeps the dialog with the error", async () => {
    const g = gate();
    const run = vi.fn().mockRejectedValueOnce(new Error("nope")).mockResolvedValueOnce(undefined);
    await g.request({ op: "dropCollection", target: T, count: 1 }, run);
    await g.confirm();
    expect(g.pending).not.toBeNull();
    expect(g.error).toContain("nope");
    await g.confirm();
    expect(run).toHaveBeenCalledTimes(2);
    expect(g.pending).toBeNull();
  });

  it("skipConfirm runs straight away when only a plain confirm would be needed", async () => {
    const g = gate("dev");
    const run = vi.fn().mockResolvedValue(undefined);
    await g.request({ op: "deleteMany", target: T, count: 5, skipConfirm: true }, run);
    expect(run).toHaveBeenCalled();
    expect(g.pending).toBeNull();
    const g2 = gate("prod");
    const run2 = vi.fn();
    await g2.request({ op: "deleteMany", target: T, count: 5, skipConfirm: true }, run2);
    expect(run2).not.toHaveBeenCalled();
    expect(g2.pending?.level).toBe("type");
  });

  it("forceType always requires typing", async () => {
    const g = gate("dev");
    await g.request({ op: "deleteMany", target: T, count: 5, forceType: true }, vi.fn());
    expect(g.pending?.level).toBe("type");
  });

  it("cancel clears; a late count for a cancelled request is ignored", async () => {
    const g = gate();
    let resolve!: (n: number) => void;
    const p = g.request({ op: "deleteMany", target: T, fetchCount: () => new Promise<number>((r) => (resolve = r)) }, vi.fn());
    g.cancel();
    resolve(9);
    await p;
    expect(g.pending).toBeNull();
  });

  it("count results can carry size and collection counts", async () => {
    const g = gate();
    await g.request({ op: "dropDatabase", target: { db: "shop" }, fetchCount: async () => ({ count: 10, collections: 3, bytes: 2048 }) }, vi.fn());
    expect(g.pending).toMatchObject({ count: 10, collections: 3, bytes: 2048 });
  });
});
