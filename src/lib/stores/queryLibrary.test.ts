import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/queryLibrary", () => ({
  loadQueryLibrary: vi.fn(),
  saveQueryLibrary: vi.fn(),
}));

import { loadQueryLibrary, saveQueryLibrary } from "../api/queryLibrary";
import { createQueryLibrary } from "./queryLibrary.svelte";
import type { QueryNode } from "../domain/queryTree";

const folder: QueryNode = { id: 1, parentId: null, kind: "folder", name: "Reports" };
const query: QueryNode = {
  id: 2, parentId: 1, kind: "query", name: "Active", statement: "db.u.find()", db: "app", updatedAt: 1,
};

describe("queryLibrary store", () => {
  beforeEach(() => {
    vi.mocked(loadQueryLibrary).mockReset().mockResolvedValue([]);
    vi.mocked(saveQueryLibrary).mockReset().mockResolvedValue(undefined);
  });

  it("load populates nodes and sets loaded", async () => {
    vi.mocked(loadQueryLibrary).mockResolvedValue([folder, query]);
    const lib = createQueryLibrary();
    await lib.load();
    expect(lib.nodes.length).toBe(2);
    expect(lib.loaded).toBe(true);
    expect(lib.loadError).toBeNull();
  });

  it("load failure sets loadError, keeps library empty, blocks mutations", async () => {
    vi.mocked(loadQueryLibrary).mockRejectedValue({ kind: "Parse", message: "bad json" });
    const lib = createQueryLibrary();
    await lib.load();
    expect(lib.loadError).toContain("bad json");
    expect(lib.blocked).toBe(true);
    expect(await lib.saveQuery("n", "s", null, null)).toBeNull();
    await lib.rename(1, "x");
    expect(saveQueryLibrary).not.toHaveBeenCalled();
  });

  it("saveQuery appends a node and persists the full list", async () => {
    const lib = createQueryLibrary();
    await lib.load();
    const id = await lib.saveQuery("Active", "db.u.find()", "app", null);
    expect(id).toBe(1);
    expect(vi.mocked(saveQueryLibrary).mock.calls[0][0]).toHaveLength(1);
    expect(lib.queryName(1)).toBe("Active");
  });

  it("overwrite updates statement, db and updatedAt", async () => {
    vi.mocked(loadQueryLibrary).mockResolvedValue([query]);
    const lib = createQueryLibrary();
    await lib.load();
    await lib.overwrite(2, "db.u.find({a:1})", "other");
    const n = lib.nodes[0];
    expect(n.kind === "query" && n.statement).toBe("db.u.find({a:1})");
    expect(n.kind === "query" && n.db).toBe("other");
    expect(n.kind === "query" && n.updatedAt).toBeGreaterThan(1);
  });

  it("remove drops the node and its descendants", async () => {
    vi.mocked(loadQueryLibrary).mockResolvedValue([folder, query]);
    const lib = createQueryLibrary();
    await lib.load();
    await lib.remove(1);
    expect(lib.nodes).toEqual([]);
  });

  it("move is a no-op into own descendant", async () => {
    const child: QueryNode = { id: 3, parentId: 1, kind: "folder", name: "Sub" };
    vi.mocked(loadQueryLibrary).mockResolvedValue([folder, child]);
    const lib = createQueryLibrary();
    await lib.load();
    await lib.move(1, 3);
    expect(lib.nodes.find((n) => n.id === 1)?.parentId).toBeNull();
    expect(saveQueryLibrary).not.toHaveBeenCalled();
  });

  it("persist failure keeps in-memory state and sets saveError", async () => {
    vi.mocked(saveQueryLibrary).mockRejectedValue({ kind: "Io", message: "disk full" });
    const lib = createQueryLibrary();
    await lib.load();
    const id = await lib.saveQuery("kept", "s", null, null);
    expect(id).toBe(1);
    expect(lib.nodes).toHaveLength(1);
    expect(lib.saveError).toContain("disk full");
  });

  it("queryName returns null for folders and unknown ids", async () => {
    vi.mocked(loadQueryLibrary).mockResolvedValue([folder, query]);
    const lib = createQueryLibrary();
    await lib.load();
    expect(lib.queryName(2)).toBe("Active");
    expect(lib.queryName(1)).toBeNull();
    expect(lib.queryName(99)).toBeNull();
  });
});
