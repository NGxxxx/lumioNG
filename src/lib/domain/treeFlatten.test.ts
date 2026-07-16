import { describe, it, expect } from "vitest";
import { flattenDocs, fieldPath, fullDepthPaths, type TreeRow } from "./treeFlatten";

const docs = [
  {
    _id: { $oid: "aabbcc" },
    name: "Ada",
    address: { city: "Hanoi", geo: { lat: 21, lng: 105 } },
    tags: ["a", "b"],
    empty: {},
  },
  { _id: { $oid: "ddeeff" }, n: { $numberInt: "5" } },
];

function paths(rows: TreeRow[]): string[] {
  return rows.map((r) => r.path);
}

describe("flattenDocs", () => {
  it("collapsed default: one doc row per document", () => {
    const rows = flattenDocs(docs, new Set());
    expect(paths(rows)).toEqual(["#0", "#1"]);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].docIndex).toBe(0);
    expect(rows[0].expandable).toBe(true);
    expect(rows[0].childCount).toBe(4); // name, address, tags, empty — _id excluded
  });

  it("expanding a doc emits its top-level fields (no _id), depth 1", () => {
    const rows = flattenDocs(docs, new Set(["#0"]));
    expect(paths(rows)).toEqual(["#0", "#0.name", "#0.address", "#0.tags", "#0.empty", "#1"]);
    const address = rows[2];
    expect(address.key).toBe("address");
    expect(address.depth).toBe(1);
    expect(address.docIndex).toBe(0);
    expect(address.expandable).toBe(true);
    expect(address.childCount).toBe(2);
  });

  it("expanding nested object and array emits grandchildren depth-first", () => {
    const rows = flattenDocs(docs, new Set(["#0", "#0.address", "#0.address.geo", "#0.tags"]));
    expect(paths(rows)).toEqual([
      "#0", "#0.name",
      "#0.address", "#0.address.city", "#0.address.geo", "#0.address.geo.lat", "#0.address.geo.lng",
      "#0.tags", "#0.tags.0", "#0.tags.1",
      "#0.empty", "#1",
    ]);
    const tag0 = rows.find((r) => r.path === "#0.tags.0")!;
    expect(tag0.key).toBe("0");
    expect(tag0.depth).toBe(2);
    expect(tag0.value).toBe("a");
  });

  it("open paths on collapsed ancestors emit nothing", () => {
    // #0 itself is closed, so the open nested path is invisible.
    expect(paths(flattenDocs(docs, new Set(["#0.address"])))).toEqual(["#0", "#1"]);
  });

  it("ExtJSON wrappers are leaves; empty containers are not expandable", () => {
    const rows = flattenDocs(docs, new Set(["#0", "#1"]));
    const n = rows.find((r) => r.path === "#1.n")!;
    expect(n.expandable).toBe(false);
    expect(n.childCount).toBe(null);
    const empty = rows.find((r) => r.path === "#0.empty")!;
    expect(empty.expandable).toBe(false);
    expect(empty.childCount).toBe(0);
  });

  it("array/string/null leaves report childCount null", () => {
    const rows = flattenDocs(docs, new Set(["#0"]));
    const name = rows.find((r) => r.path === "#0.name")!;
    expect(name.expandable).toBe(false);
    expect(name.childCount).toBe(null);
  });
});

describe("fullDepthPaths", () => {
  it("collects the doc row plus every nested container path, at every depth", () => {
    const paths = fullDepthPaths(docs[0], 0);
    expect(paths).toEqual(new Set([
      "#0", "#0.address", "#0.address.geo", "#0.tags",
      // "#0.empty" is excluded: an empty object has no children, so it isn't expandable.
    ]));
  });

  it("flattening with these paths open shows every leaf for that document", () => {
    const open = fullDepthPaths(docs[0], 0);
    const rows = flattenDocs(docs, open);
    expect(rows.map((r) => r.path)).toEqual([
      "#0", "#0.name",
      "#0.address", "#0.address.city", "#0.address.geo", "#0.address.geo.lat", "#0.address.geo.lng",
      "#0.tags", "#0.tags.0", "#0.tags.1",
      "#0.empty", "#1",
    ]);
  });

  it("a document with no expandable fields yields just its own doc-row path", () => {
    expect(fullDepthPaths(docs[1], 1)).toEqual(new Set(["#1"]));
  });
});

describe("fieldPath", () => {
  it("strips the doc prefix", () => {
    expect(fieldPath("#0.address.city")).toBe("address.city");
    expect(fieldPath("#12.tags.3")).toBe("tags.3");
  });
  it("doc row path yields empty string", () => {
    expect(fieldPath("#0")).toBe("");
  });
});
