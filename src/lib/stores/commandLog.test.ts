import { describe, it, expect } from "vitest";
import { createCommandLog } from "./commandLog.svelte";

describe("createCommandLog", () => {
  it("push appends entries with incrementing counter starting at 1", () => {
    const log = createCommandLog();
    log.push("a");
    log.push("b");
    expect(log.entries).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
    ]);
  });

  it("exceeding the limit trims oldest entries while counter keeps incrementing", () => {
    const log = createCommandLog(2);
    log.push("a");
    log.push("b");
    log.push("c");
    expect(log.entries).toEqual([
      { n: 2, text: "b" },
      { n: 3, text: "c" },
    ]);
  });

  it("clear empties all entries", () => {
    const log = createCommandLog();
    log.push("a");
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
