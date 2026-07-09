import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { aggregate, aggregateCount, explainQuery } from "./documents";

const inv = invoke as ReturnType<typeof vi.fn>;

describe("aggregate / aggregateCount wrappers", () => {
  it("aggregate passes skip and limit through to the aggregate command", async () => {
    inv.mockResolvedValueOnce(['{"a":1}']);
    const docs = await aggregate("conn:1", "d", "c", "[]", 10, 5);
    expect(inv).toHaveBeenCalledWith("aggregate", {
      sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]", skip: 10, limit: 5,
    });
    expect(docs).toEqual([{ a: 1 }]);
  });

  it("aggregateCount calls the aggregate_count command and returns the count", async () => {
    inv.mockResolvedValueOnce(42);
    const n = await aggregateCount("conn:1", "d", "c", "[]");
    expect(inv).toHaveBeenCalledWith("aggregate_count", { sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]" });
    expect(n).toBe(42);
  });
});

describe("explainQuery wrapper", () => {
  it("dispatches to explain_find for cursorKind 'find'", async () => {
    inv.mockResolvedValueOnce('{"queryPlanner":{}}');
    const s = await explainQuery("conn:1", "find", "d", "c", "{}", null, null, 0, null);
    expect(inv).toHaveBeenCalledWith("explain_find", {
      sessionId: "conn:1", db: "d", coll: "c", filter: "{}", sort: null, projection: null, skip: 0, limit: null,
    });
    expect(s).toBe('{"queryPlanner":{}}');
  });

  it("dispatches to explain_aggregate for cursorKind 'agg'", async () => {
    inv.mockResolvedValueOnce('{"stages":[]}');
    const s = await explainQuery("conn:1", "agg", "d", "c", "[]", null, null, 0, 5);
    expect(inv).toHaveBeenCalledWith("explain_aggregate", {
      sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]", skip: 0, limit: 5,
    });
    expect(s).toBe('{"stages":[]}');
  });
});
