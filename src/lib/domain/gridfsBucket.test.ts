import { describe, it, expect } from "vitest";
import { detectGridFsBucket } from "./gridfsBucket";

describe("detectGridFsBucket", () => {
  it("detects the default 'fs' bucket", () => {
    expect(detectGridFsBucket(["fs.files", "fs.chunks", "other"], "fs.files")).toBe("fs");
  });
  it("detects a custom bucket name", () => {
    expect(detectGridFsBucket(["photos.files", "photos.chunks"], "photos.files")).toBe("photos");
  });
  it("detects a bucket name that itself contains dots", () => {
    expect(detectGridFsBucket(["my.bucket.files", "my.bucket.chunks"], "my.bucket.files")).toBe("my.bucket");
  });
  it("returns null when the sibling .chunks collection is missing", () => {
    expect(detectGridFsBucket(["fs.files"], "fs.files")).toBeNull();
  });
  it("returns null when the sibling .files collection is missing", () => {
    expect(detectGridFsBucket(["fs.chunks"], "fs.chunks")).toBeNull();
  });
  it("returns null for the .chunks collection itself, even with its sibling present", () => {
    expect(detectGridFsBucket(["fs.files", "fs.chunks"], "fs.chunks")).toBeNull();
  });
  it("returns null for a collection that merely ends in the letters 'files' without the dot", () => {
    expect(detectGridFsBucket(["userfiles", "userfiles.chunks"], "userfiles")).toBeNull();
  });
  it("returns null for the degenerate name '.files' with an empty prefix", () => {
    expect(detectGridFsBucket([".files", ".chunks"], ".files")).toBeNull();
  });

  describe("empty-bucket relaxation (filesIsEmpty)", () => {
    it("returns null when .chunks is missing and filesIsEmpty is omitted (default false, old strict behavior)", () => {
      expect(detectGridFsBucket(["fs.files"], "fs.files")).toBeNull();
    });
    it("returns null when .chunks is missing and filesIsEmpty is explicitly false", () => {
      expect(detectGridFsBucket(["fs.files"], "fs.files", false)).toBeNull();
    });
    it("returns the prefix when .chunks is missing but the caller confirms .files is empty", () => {
      expect(detectGridFsBucket(["fs.files"], "fs.files", true)).toBe("fs");
    });
    it("still returns the prefix when .chunks is present, regardless of filesIsEmpty", () => {
      expect(detectGridFsBucket(["fs.files", "fs.chunks"], "fs.files", false)).toBe("fs");
    });
    it("does not false-positive on an arbitrary non-empty 'X.files' collection with no .chunks sibling", () => {
      // filesIsEmpty: false because the caller's count check found real documents.
      expect(detectGridFsBucket(["orders.files"], "orders.files", false)).toBeNull();
    });
  });
});
