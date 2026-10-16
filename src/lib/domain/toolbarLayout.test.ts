import { describe, it, expect } from "vitest";
import { toolbarFor } from "./toolbarLayout";

describe("toolbarFor", () => {
  it("collection data view: refresh/import/export/watch, overflow extras, New document as primary", () => {
    const entries = toolbarFor("collection.data");
    expect(entries.map((e) => e.id)).toEqual([
      "file.refresh",
      "file.import",
      "file.export",
      "query.watch",
      "query.aggregate",
      "grid.focusFilter",
      "view.toggleWrap",
      "view.toggleSavedQueries",
      "view.resetLayout",
      "file.newDocument",
    ]);
    expect(entries.filter((e) => e.style === "primary").map((e) => e.id)).toEqual(["file.newDocument"]);
    expect(entries.filter((e) => e.overflow).map((e) => e.id)).toEqual([
      "query.aggregate",
      "grid.focusFilter",
      "view.toggleWrap",
      "view.toggleSavedQueries",
      "view.resetLayout",
    ]);
  });

  it("schema / indexes / info only refresh; host also watches the deployment", () => {
    for (const v of ["collection.schema", "collection.indexes", "collection.info"] as const) {
      expect(toolbarFor(v).map((e) => e.id)).toEqual(["file.refresh"]);
    }
    expect(toolbarFor("host").map((e) => e.id)).toEqual(["file.refresh", "query.watch"]);
  });

  it("database: refresh, import, watch, new query in overflow", () => {
    expect(toolbarFor("database")).toEqual([
      { id: "file.refresh", style: "icon" },
      { id: "file.import", style: "icon" },
      { id: "query.watch", style: "icon" },
      { id: "file.newQuery", style: "icon", overflow: true },
    ]);
  });

  it("query tab has no header actions (they live in its title row)", () => {
    expect(toolbarFor("query")).toEqual([]);
  });

  it("watch tab has no header actions (they live in its own bar)", () => {
    expect(toolbarFor("watch")).toEqual([]);
  });

  it("document tab: Save as primary", () => {
    expect(toolbarFor("document")).toEqual([{ id: "query.save", style: "primary" }]);
  });
});
