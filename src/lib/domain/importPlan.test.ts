import { describe, it, expect } from "vitest";
import {
  describeSqlImportTargets,
  describeImportTarget,
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

describe("describeImportTarget", () => {
  it("blank input is unset — no notice to show", () => {
    expect(describeImportTarget("", ["users"])).toEqual({ kind: "unset" });
    expect(describeImportTarget("   ", ["users"])).toEqual({ kind: "unset" });
  });
  it("a name matching an existing collection is 'existing'", () => {
    expect(describeImportTarget("users", ["users", "orders"])).toEqual({ kind: "existing", coll: "users" });
  });
  it("a name not in the existing list is 'new'", () => {
    expect(describeImportTarget("users_backup", ["users", "orders"])).toEqual({ kind: "new", coll: "users_backup" });
  });
  it("trims surrounding whitespace before comparing", () => {
    expect(describeImportTarget("  users  ", ["users"])).toEqual({ kind: "existing", coll: "users" });
  });
  it("trims whitespace on the 'new' path too, not just when matching an existing name", () => {
    expect(describeImportTarget("  new_coll  ", ["users"])).toEqual({ kind: "new", coll: "new_coll" });
  });
});
