import { describe, it, expect } from "vitest";
import { toolbarFor } from "./toolbarLayout";

describe("toolbarFor", () => {
  it("collection data view: refresh/import/export, overflow extras, New document as primary", () => {
    const entries = toolbarFor("collection.data");
    expect(entries.map((e) => e.id)).toEqual([
      "file.refresh",
      "file.import",
      "file.export",
      "query.aggregate",
      "grid.focusFilter",
      "view.toggleWrap",
      "view.toggleSavedQueries",
      "file.newDocument",
    ]);
    expect(entries.filter((e) => e.style === "primary").map((e) => e.id)).toEqual(["file.newDocument"]);
    expect(entries.filter((e) => e.overflow).map((e) => e.id)).toEqual([
      "query.aggregate",
      "grid.focusFilter",
      "view.toggleWrap",
      "view.toggleSavedQueries",
    ]);
  });

  it("schema / indexes / info / host only refresh", () => {
    for (const v of ["collection.schema", "collection.indexes", "collection.info", "host"] as const) {
      expect(toolbarFor(v).map((e) => e.id)).toEqual(["file.refresh"]);
    }
  });

  it("database: refresh, import, new query in overflow", () => {
    expect(toolbarFor("database")).toEqual([
      { id: "file.refresh", style: "icon" },
      { id: "file.import", style: "icon" },
      { id: "file.newQuery", style: "icon", overflow: true },
    ]);
  });

  it("query tab has no header actions (they live in its title row)", () => {
    expect(toolbarFor("query")).toEqual([]);
  });

  it("document tab: Save as primary", () => {
    expect(toolbarFor("document")).toEqual([{ id: "query.save", style: "primary" }]);
  });
});
