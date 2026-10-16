import { describe, it, expect, vi } from "vitest";
import { createCommandLog, LOG_CHAR_BUDGET, LOG_ENTRY_MAX, LOG_PREVIEW, type CommandLogDeps } from "./commandLog.svelte";

const noFile: CommandLogDeps = {
  toFile: () => false,
  append: async () => ({ path: "", offset: 0, length: 0 }),
  read: async () => "",
  label: (id) => id,
};

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

  describe("pushTimed", () => {
    it("measures elapsed time and pushes an entry with that duration", async () => {
      // Fake timers mock Date.now too, so the duration is exact (a real 5 ms timer can fire when
      // Date.now has only advanced 4 ms).
      vi.useFakeTimers();
      try {
        const log = createCommandLog();
        const pending = log.pushTimed("db.x.find()", "conn:1", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return 42;
        });
        await vi.advanceTimersByTimeAsync(5);
        expect(await pending).toBe(42);
        expect(log.entries).toHaveLength(1);
        expect(log.entries[0]).toMatchObject({ text: "db.x.find()", sessionId: "conn:1", tookMs: 5 });
      } finally {
        vi.useRealTimers();
      }
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

  describe("unseen counter", () => {
    it("counts pushes until markSeen", () => {
      const log = createCommandLog();
      log.push("a", "s", 1);
      log.push("b", "s", 1);
      expect(log.unseen).toBe(2);
      log.markSeen();
      expect(log.unseen).toBe(0);
    });
    it("clear resets the counter", () => {
      const log = createCommandLog();
      log.push("a", "s", 1);
      log.clear();
      expect(log.unseen).toBe(0);
    });
  });

  it("keeps recent commands whole; past the memory budget the oldest are cut to a preview", () => {
    const log = createCommandLog(500, { ...noFile });
    const big = "x".repeat(LOG_CHAR_BUDGET / 4);
    for (let i = 0; i < 5; i++) log.push(big, "conn:1", 1);
    const kept = log.entries.map((e) => [e.text.length, e.clipped, e.length]);
    // 5 × budget/4 is over budget: the two oldest are cut, the three newest stay whole.
    expect(kept.slice(0, 2)).toEqual(Array(2).fill([LOG_PREVIEW, true, big.length]));
    expect(kept.slice(2)).toEqual(Array(3).fill([big.length, false, big.length]));
  });

  it("a single command over the per-entry cap is only kept as a preview", () => {
    const log = createCommandLog(500, { ...noFile });
    log.push("y".repeat(LOG_ENTRY_MAX + 1), "conn:1", 1);
    expect(log.entries[0]).toMatchObject({ clipped: true, length: LOG_ENTRY_MAX + 1 });
    expect(log.entries[0].text.length).toBe(LOG_PREVIEW);
  });

  describe("saving to file", () => {
    const ref = { path: "/logs/commands-2026-10-16.log", offset: 40, length: 9 };

    it("writes the full text with a readable header when enabled, and remembers where", async () => {
      const append = vi.fn(async () => ref);
      const log = createCommandLog(500, { ...noFile, toFile: () => true, append, label: () => "Prod" });
      log.push("db.x.find()", "conn:1", 7);
      await vi.waitFor(() => expect(log.entries[0].file).toEqual(ref));
      const [header, text] = append.mock.calls[0] as unknown as [string, string];
      expect(text).toBe("db.x.find()");
      expect(header).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}  Prod  7 ms$/);
    });

    it("writes nothing while disabled", () => {
      const append = vi.fn();
      const log = createCommandLog(500, { ...noFile, append });
      log.push("db.x.find()", "conn:1", 7);
      expect(append).not.toHaveBeenCalled();
    });

    it("reports a failed write and clears the error after the next success", async () => {
      const append = vi.fn().mockRejectedValueOnce({ kind: "Io", message: "disk full" }).mockResolvedValueOnce(ref);
      const log = createCommandLog(500, { ...noFile, toFile: () => true, append });
      log.push("a", "conn:1", 1);
      await vi.waitFor(() => expect(log.fileError).toBe("Io: disk full"));
      log.push("b", "conn:1", 1);
      await vi.waitFor(() => expect(log.fileError).toBeNull());
    });

    it("fullText: whole from memory, else from the file, else the preview marked incomplete", async () => {
      const read = vi.fn(async () => "z".repeat(LOG_ENTRY_MAX + 1));
      const log = createCommandLog(500, { ...noFile, toFile: () => true, append: async () => ref, read });
      log.push("short", "conn:1", 1);
      log.push("z".repeat(LOG_ENTRY_MAX + 1), "conn:1", 1);
      await vi.waitFor(() => expect(log.entries[1].file).toEqual(ref));
      expect(await log.fullText(log.entries[0])).toEqual({ text: "short", complete: true });
      expect((await log.fullText(log.entries[1])).complete).toBe(true);
      expect(read).toHaveBeenCalledWith(ref);
      read.mockRejectedValueOnce(new Error("gone"));
      const r = await log.fullText(log.entries[1]);
      expect(r).toEqual({ text: "z".repeat(LOG_PREVIEW), complete: false });
    });
  });
});
