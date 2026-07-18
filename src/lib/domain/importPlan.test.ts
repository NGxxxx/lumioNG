import { describe, it, expect } from "vitest";
import {
  describeSqlImportTargets,
  isLargeImportFile,
  formatFileSize,
  LARGE_IMPORT_FILE_BYTES,
} from "./importPlan";

describe("describeSqlImportTargets", () => {
  it("single-table dump with a pre-selected coll always targets that coll", () => {
    expect(describeSqlImportTargets(1, ["movie"], "films")).toEqual({ kind: "existing", coll: "films" });
  });
  it("single-table dump with no pre-selected coll creates one new collection", () => {
    expect(describeSqlImportTargets(1, ["movie"], null)).toEqual({ kind: "new", collections: ["movie"] });
  });
  it("multi-table dump ignores targetColl and lists only the currently selected tables", () => {
    expect(describeSqlImportTargets(3, ["users"], "films")).toEqual({ kind: "new", collections: ["users"] });
  });
  it("reflects a selection change (pure function — called again with a different selected list)", () => {
    expect(describeSqlImportTargets(3, ["users", "orders"], null))
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
