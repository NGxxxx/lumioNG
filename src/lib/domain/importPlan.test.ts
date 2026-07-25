import { describe, it, expect } from "vitest";
import {
  describeSqlImportTargets,
  isLargeImportFile,
  formatFileSize,
  LARGE_IMPORT_FILE_BYTES,
} from "./importPlan";

describe("describeSqlImportTargets", () => {
  it("a non-blank target collection takes every selected table, regardless of table count", () => {
    expect(describeSqlImportTargets(["movie"], "films")).toEqual({ kind: "existing", coll: "films" });
    expect(describeSqlImportTargets(["users", "orders"], "films")).toEqual({ kind: "existing", coll: "films" });
  });
  it("a blank/null target creates one new collection per selected table", () => {
    expect(describeSqlImportTargets(["movie"], null)).toEqual({ kind: "new", collections: ["movie"] });
    expect(describeSqlImportTargets(["users"], "   ")).toEqual({ kind: "new", collections: ["users"] });
  });
  it("reflects a selection change (pure function — called again with a different selected list)", () => {
    expect(describeSqlImportTargets(["users", "orders"], null))
      .toEqual({ kind: "new", collections: ["users", "orders"] });
  });
});

describe("isLargeImportFile", () => {
  it("exactly the threshold is not large", () => {
    expect(isLargeImportFile(LARGE_IMPORT_FILE_BYTES)).toBe(false);
  });
  it("one byte over the threshold is large", () => {
    expect(isLargeImportFile(LARGE_IMPORT_FILE_BYTES + 1)).toBe(true);
  });
});

describe("formatFileSize", () => {
  it("formats bytes as MB with one decimal", () => {
    expect(formatFileSize(200 * 1024 * 1024)).toBe("200.0 MB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1536 * 1024)).toBe("1.5 MB");
  });
});
