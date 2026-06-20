import { describe, it, expect } from "vitest";
import { createCommandLog } from "./commandLog.svelte";

describe("createCommandLog", () => {
  it("push thêm mục, đánh số tăng dần từ 1", () => {
    const log = createCommandLog();
    log.push("a");
    log.push("b");
    expect(log.entries).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
    ]);
  });

  it("vượt limit thì cắt mục cũ nhất, số n vẫn tăng", () => {
    const log = createCommandLog(2);
    log.push("a");
    log.push("b");
    log.push("c");
    expect(log.entries).toEqual([
      { n: 2, text: "b" },
      { n: 3, text: "c" },
    ]);
  });

  it("clear xóa hết", () => {
    const log = createCommandLog();
    log.push("a");
    log.clear();
    expect(log.entries).toEqual([]);
  });

  it("toggle đảo trạng thái open", () => {
    const log = createCommandLog();
    expect(log.open).toBe(true);
    log.toggle();
    expect(log.open).toBe(false);
  });
});
