import { describe, it, expect, vi } from "vitest";
import { createCommandLog } from "./commandLog.svelte";

describe("createCommandLog", () => {
  it("push appends entries with incrementing counter, timestamp, and duration", () => {
    const log = createCommandLog();
    const before = Date.now();
    log.push("a", "sess:1", 5);
    log.push("b", "sess:2", 12);
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]).toMatchObject({ n: 1, text: "a", sessionId: "sess:1", tookMs: 5 });
    expect(log.entries[1]).toMatchObject({ n: 2, text: "b", sessionId: "sess:2", tookMs: 12 });
    expect(log.entries[0].at).toBeGreaterThanOrEqual(before);
    expect(log.entries[1].at).toBeGreaterThanOrEqual(log.entries[0].at);
  });

  it("stores sessionId and tookMs on each entry", () => {
    const log = createCommandLog();
    log.push("db.x.find()", "conn:1", 7);
    expect(log.entries.at(-1)).toMatchObject({ text: "db.x.find()", sessionId: "conn:1", tookMs: 7 });
  });

  it("exceeding the limit trims oldest entries while counter keeps incrementing", () => {
    const log = createCommandLog(2);
    log.push("a", "s", 1);
    log.push("b", "s", 1);
    log.push("c", "s", 1);
    expect(log.entries.map((e) => e.n)).toEqual([2, 3]);
    expect(log.entries.map((e) => e.text)).toEqual(["b", "c"]);
  });

  it("clear empties all entries", () => {
    const log = createCommandLog();
    log.push("a", "s", 1);
    log.clear();
    expect(log.entries).toEqual([]);
  });

  it("toggle flips the open state", () => {
    const log = createCommandLog();
    expect(log.open).toBe(true);
    log.toggle();
    expect(log.open).toBe(false);
  });

  describe("pushTimed", () => {
    it("measures elapsed time and pushes an entry with that duration", async () => {
      const log = createCommandLog();
      const result = await log.pushTimed("db.x.find()", "conn:1", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 42;
      });
      expect(result).toBe(42);
      expect(log.entries).toHaveLength(1);
      expect(log.entries[0]).toMatchObject({ text: "db.x.find()", sessionId: "conn:1" });
      expect(log.entries[0].tookMs).toBeGreaterThanOrEqual(5);
    });

    it("does not push an entry when fn rejects, and rethrows", async () => {
      const log = createCommandLog();
      await expect(
        log.pushTimed("db.x.find()", "conn:1", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(log.entries).toEqual([]);
    });
  });
});
