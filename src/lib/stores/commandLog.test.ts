import { describe, it, expect } from "vitest";
import { createCommandLog } from "./commandLog.svelte";

describe("createCommandLog", () => {
  it("push appends entries with incrementing counter starting at 1", () => {
    const log = createCommandLog();
    log.push("a", "sess:1");
    log.push("b", "sess:2");
    expect(log.entries).toEqual([
      { n: 1, text: "a", sessionId: "sess:1" },
      { n: 2, text: "b", sessionId: "sess:2" },
    ]);
  });

  it("stores sessionId on each entry", () => {
    const log = createCommandLog();
    log.push("db.x.find()", "conn:1");
    expect(log.entries.at(-1)).toMatchObject({ text: "db.x.find()", sessionId: "conn:1" });
  });

  it("exceeding the limit trims oldest entries while counter keeps incrementing", () => {
    const log = createCommandLog(2);
    log.push("a", "s");
    log.push("b", "s");
    log.push("c", "s");
    expect(log.entries).toEqual([
      { n: 2, text: "b", sessionId: "s" },
      { n: 3, text: "c", sessionId: "s" },
    ]);
  });

  it("clear empties all entries", () => {
    const log = createCommandLog();
    log.push("a", "s");
    log.clear();
    expect(log.entries).toEqual([]);
  });

  it("toggle flips the open state", () => {
    const log = createCommandLog();
    expect(log.open).toBe(true);
    log.toggle();
    expect(log.open).toBe(false);
  });
});
