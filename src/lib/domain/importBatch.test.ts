import { describe, expect, it } from "vitest";
import { batchTargetErrors, collectionNameFromFile, importFormatOf, planImportBatch } from "./importBatch";

describe("importFormatOf", () => {
  it("maps the extension, unknown ones read as JSON", () => {
    expect(["a.SQL", "a.csv", "a.bson", "a.jsonl", "a.json", "a.txt"].map(importFormatOf)).toEqual(["sql", "csv", "bson", "jsonl", "json", "json"]);
  });
});

describe("collectionNameFromFile", () => {
  it("drops the directory and only the format extension", () => {
    expect(collectionNameFromFile("/dump/shop/orders.bson")).toBe("orders");
    expect(collectionNameFromFile("C:\\data\\logs.2024.JSONL")).toBe("logs.2024");
    expect(collectionNameFromFile("users.csv")).toBe("users");
  });
});

describe("planImportBatch", () => {
  it("names a collection per data file; skipped files (sidecars, SQL, unknown) come last; each group by name", () => {
    const plan = planImportBatch(["/d/users.bson", "/d/users.metadata.json", "/d/a.sql", "/d/notes.txt", "/d/events.jsonl", "/d/prelude.json"]);
    expect(plan.map((e) => [e.fileName, e.coll, e.skip])).toEqual([
      ["events.jsonl", "events", null],
      ["users.bson", "users", null],
      ["a.sql", "", "sql"],
      ["notes.txt", "", "unsupported"],
      ["prelude.json", "", "metadata"],
      ["users.metadata.json", "", "metadata"],
    ]);
  });
});

describe("batchTargetErrors", () => {
  it("flags invalid and duplicate target names, never skipped entries", () => {
    expect(batchTargetErrors([
      { coll: "a", skip: null },
      { coll: " a ", skip: null },
      { coll: "", skip: null },
      { coll: "b", skip: null },
      { coll: "", skip: "sql" },
    ])).toEqual(["err_coll_name_duplicate", "err_coll_name_duplicate", "err_coll_name_empty", null, null]);
  });
});
