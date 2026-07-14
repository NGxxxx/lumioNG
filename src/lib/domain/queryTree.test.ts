import { describe, expect, it } from "vitest";
import {
  canMove,
  childrenOf,
  descendantIds,
  folderOptions,
  nextId,
  queryCountIn,
  visibleRows,
  type QueryNode,
} from "./queryTree";

const f = (id: number, parentId: number | null, name: string): QueryNode => ({
  id, parentId, kind: "folder", name,
});
const q = (id: number, parentId: number | null, name: string): QueryNode => ({
  id, parentId, kind: "query", name, statement: "db.a.find()", db: null, updatedAt: 0,
});

// root: folder B(1), folder a(2), query z(3), query A(4); inside B: folder C(5), query d(6)
const nodes: QueryNode[] = [f(1, null, "B"), f(2, null, "a"), q(3, null, "z"), q(4, null, "A"), f(5, 1, "C"), q(6, 1, "d")];

describe("childrenOf", () => {
  it("sorts folders first, then case-insensitive by name", () => {
    expect(childrenOf(nodes, null).map((n) => n.id)).toEqual([2, 1, 4, 3]); // a, B, A, z
  });
});

describe("visibleRows", () => {
  it("skips children of collapsed folders", () => {
    expect(visibleRows(nodes, new Set()).map((r) => r.node.id)).toEqual([2, 1, 4, 3]);
  });
  it("includes expanded folder children with depth", () => {
    const rows = visibleRows(nodes, new Set([1]));
    expect(rows.map((r) => r.node.id)).toEqual([2, 1, 5, 6, 4, 3]);
    expect(rows.find((r) => r.node.id === 5)?.depth).toBe(1);
    expect(rows.find((r) => r.node.id === 1)?.depth).toBe(0);
  });
});

describe("ids and counts", () => {
  it("nextId is max+1, 1 on empty", () => {
    expect(nextId(nodes)).toBe(7);
    expect(nextId([])).toBe(1);
  });
  it("descendantIds collects nested children, not the node itself", () => {
    expect(descendantIds(nodes, 1).sort()).toEqual([5, 6]);
    expect(descendantIds(nodes, 5)).toEqual([]);
  });
  it("queryCountIn counts only query descendants", () => {
    expect(queryCountIn(nodes, 1)).toBe(1);
    expect(queryCountIn(nodes, 2)).toBe(0);
  });
});

describe("canMove", () => {
  it("allows moving to root and to an unrelated folder", () => {
    expect(canMove(nodes, 6, null)).toBe(true);
    expect(canMove(nodes, 3, 5)).toBe(true);
  });
  it("rejects self, own descendant, query targets, unknown targets", () => {
    expect(canMove(nodes, 1, 1)).toBe(false);
    expect(canMove(nodes, 1, 5)).toBe(false);
    expect(canMove(nodes, 1, 3)).toBe(false);
    expect(canMove(nodes, 1, 99)).toBe(false);
  });
});

describe("folderOptions", () => {
  it("lists root then folders depth-first with indentation", () => {
    const opts = folderOptions(nodes, "(root)");
    expect(opts.map((o) => o.id)).toEqual([null, 2, 1, 5]);
    expect(opts[0].label).toBe("(root)");
    expect(opts[3].label.trimStart()).toBe("C");
    expect(opts[3].label.length).toBeGreaterThan(1); // indented under B
  });
});
