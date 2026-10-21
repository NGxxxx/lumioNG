import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DatabaseDiagram from "./DatabaseDiagram.svelte";

function fake(over: Record<string, unknown> = {}) {
  const edge = { id: "orders.userId->users", from: "orders", path: "userId", to: "users", many: false, score: 1, hits: 5, sampled: 5, sampleIds: [], confirmed: false, removed: false };
  return {
    running: false, finished: true, done: 3, total: 3, truncated: false, error: null, failed: [],
    nodes: [
      { name: "orders", x: 24, y: 24, w: 190, h: 60, fields: ["userId"] },
      { name: "users", x: 284, y: 24, w: 190, h: 60, fields: [] },
    ],
    edges: [edge], removed: [], minScore: 0.8,
    start: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), remove: vi.fn(), restore: vi.fn(), moveNode: vi.fn(),
    filterFor: vi.fn(() => '{"_id":{"$in":[]}}'), exportSvg: vi.fn(), svgText: vi.fn(), savePng: vi.fn(),
    ...over,
  };
}

describe("DatabaseDiagram", () => {
  it("clicking an edge opens details; the filter opens on the target collection", async () => {
    const d = fake();
    const onopenfilter = vi.fn();
    const { getByLabelText, getByText } = render(DatabaseDiagram, { diagram: d as never, db: "shop", onopenfilter, onclose: vi.fn() });
    await fireEvent.click(getByLabelText("orders.userId references users"));
    await fireEvent.click(getByText("Open filter on users"));
    expect(onopenfilter).toHaveBeenCalledWith("users", '{"_id":{"$in":[]}}');
    await fireEvent.click(getByText("Confirm"));
    expect(d.confirm).toHaveBeenCalledWith("orders.userId->users");
  });

  it("nodes move with the keyboard; cancel shows while running", async () => {
    const d = fake({ running: true });
    const { getByLabelText, getByText } = render(DatabaseDiagram, { diagram: d as never, db: "shop", onopenfilter: vi.fn(), onclose: vi.fn() });
    await fireEvent.keyDown(getByLabelText("Collection orders. Arrow keys move it."), { key: "ArrowRight" });
    expect(d.moveNode).toHaveBeenCalledWith("orders", 34, 24);
    await fireEvent.click(getByText("Cancel"));
    expect(d.cancel).toHaveBeenCalled();
  });
});
