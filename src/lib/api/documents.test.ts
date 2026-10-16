import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { aggregate, aggregateCount, explainQuery, fetchFullDoc } from "./documents";

const inv = invoke as ReturnType<typeof vi.fn>;

describe("aggregate / aggregateCount wrappers", () => {
  it("aggregate passes skip and limit through to the aggregate command", async () => {
    inv.mockResolvedValueOnce([{ a: 1 }]);
    const docs = await aggregate("conn:1", "d", "c", "[]", 10, 5);
    expect(inv).toHaveBeenCalledWith("aggregate", {
      sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]", skip: 10, limit: 5, timeoutMs: null,
    });
    expect(docs).toEqual([{ a: 1 }]);
  });

  it("aggregateCount calls the aggregate_count command and returns the count", async () => {
    inv.mockResolvedValueOnce(42);
    const n = await aggregateCount("conn:1", "d", "c", "[]");
    expect(inv).toHaveBeenCalledWith("aggregate_count", {
      sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]", timeoutMs: null,
    });
    expect(n).toBe(42);
  });
});

describe("explainQuery wrapper", () => {
  it("dispatches to explain_find for cursorKind 'find'", async () => {
    inv.mockResolvedValueOnce('{"queryPlanner":{}}');
    const s = await explainQuery("conn:1", "find", "d", "c", "{}", null, null, 0, null);
    expect(inv).toHaveBeenCalledWith("explain_find", {
      sessionId: "conn:1", db: "d", coll: "c", filter: "{}", sort: null, projection: null, skip: 0, limit: null,
      timeoutMs: null,
    });
    expect(s).toBe('{"queryPlanner":{}}');
  });

  it("dispatches to explain_aggregate for cursorKind 'agg'", async () => {
    inv.mockResolvedValueOnce('{"stages":[]}');
    const s = await explainQuery("conn:1", "agg", "d", "c", "[]", null, null, 0, 5);
    expect(inv).toHaveBeenCalledWith("explain_aggregate", {
      sessionId: "conn:1", db: "d", coll: "c", pipeline: "[]", skip: 0, limit: 5, timeoutMs: null,
    });
    expect(s).toBe('{"stages":[]}');
  });
});

describe("fetchFullDoc", () => {
  it("looks the document up by _id via find_by_id and parses it", async () => {
    inv.mockResolvedValueOnce('{"_id":{"$oid":"0123456789abcdef01234567"},"a":1}');
    const doc = await fetchFullDoc("conn:1", "d", "c", '{"$oid":"0123456789abcdef01234567"}');
    expect(inv).toHaveBeenCalledWith("find_by_id", {
      sessionId: "conn:1", db: "d", coll: "c", id: '{"$oid":"0123456789abcdef01234567"}',
    });
    expect(doc).toEqual({ _id: { $oid: "0123456789abcdef01234567" }, a: 1 });
  });

  it("returns null when no document has that _id", async () => {
    inv.mockResolvedValueOnce(null);
    expect(await fetchFullDoc("conn:1", "d", "c", "1")).toBeNull();
  });
});
