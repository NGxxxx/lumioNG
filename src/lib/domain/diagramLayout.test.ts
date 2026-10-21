import { describe, it, expect } from "vitest";
import { layoutGrid, edgeGeometry, buildSvg, diagramBounds, NODE_W, type DiagramEdge } from "./diagramLayout";

const edge = (from: string, path: string, to: string, extra: Partial<DiagramEdge> = {}): DiagramEdge => ({
  id: `${from}.${path}->${to}`, from, path, to, many: false, score: 1, confirmed: false, ...extra,
});

describe("layoutGrid", () => {
  it("places the most connected collections first, in a roughly square grid without overlap", () => {
    const names = ["a", "b", "c", "d", "e"];
    const nodes = layoutGrid(names, [edge("b", "aId", "a"), edge("c", "aId", "a"), edge("d", "bId", "b")]);
    expect(nodes.map((n) => n.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(new Set(nodes.map((n) => n.x)).size).toBe(3);
    for (const [i, n] of nodes.entries()) {
      for (const m of nodes.slice(i + 1)) {
        const apart = n.x + n.w <= m.x || m.x + m.w <= n.x || n.y + n.h <= m.y || m.y + m.h <= n.y;
        expect(apart).toBe(true);
      }
    }
    expect(nodes.find((n) => n.name === "b")!.fields).toEqual(["aId"]);
  });
  it("handles no collections", () => {
    expect(layoutGrid([], [])).toEqual([]);
  });
});

describe("edgeGeometry / buildSvg", () => {
  const a = { name: "a", x: 0, y: 0, w: NODE_W, h: 60, fields: [] };
  const b = { name: "b", x: 400, y: 0, w: NODE_W, h: 60, fields: [] };
  it("connects facing sides and loops on self references", () => {
    expect(edgeGeometry(a, b).d.startsWith(`M ${NODE_W} 30`)).toBe(true);
    expect(edgeGeometry(b, a).d.startsWith("M 400 30")).toBe(true);
    expect(edgeGeometry(a, a).d.startsWith(`M ${NODE_W} `)).toBe(true);
  });
  it("exports a standalone, escaped svg; confirmed edges are solid", () => {
    const nodes = [{ ...a, name: "a<b>", fields: ["x&y"] }, b];
    const svg = buildSvg(nodes, [edge("a<b>", "x&y", "b"), edge("a<b>", "z", "b", { confirmed: true })]);
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain("a&lt;b&gt;");
    expect(svg).toContain("x&amp;y");
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
    expect(diagramBounds(nodes).w).toBeGreaterThan(590);
  });
});
