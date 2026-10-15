import { describe, it, expect } from "vitest";
import { msgCount } from "./msgkey";

describe("msgCount", () => {
  it("uses the _one form for 1 and formats the count", () => {
    expect(msgCount("undo_delete", 1)).toBe("Deleted 1 document");
    expect(msgCount("undo_delete", 1204)).toBe("Deleted 1,204 documents");
  });
  it("falls back to the key when unknown", () => {
    expect(msgCount("nope_key", 2)).toBe("nope_key");
  });
});
