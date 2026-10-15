import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/indexes", () => ({ listIndexes: vi.fn(), indexStats: vi.fn() }));
vi.mock("../api/stats", () => ({ collStats: vi.fn() }));
vi.mock("../api/mongoServer", () => ({ isMaster: vi.fn() }));
vi.mock("../api/documents", () => ({ findById: vi.fn() }));
import * as server from "../api/mongoServer";
import * as docs from "../api/documents";

import * as api from "../api/indexes";
import * as stats from "../api/stats";
import { createDbIndexCheck } from "./dbIndexCheck.svelte";

const list = api.listIndexes as ReturnType<typeof vi.fn>;
const istats = api.indexStats as ReturnType<typeof vi.fn>;
const cs = stats.collStats as ReturnType<typeof vi.fn>;
const since = { $date: { $numberLong: String(Date.now() - 30 * 86_400_000) } };
const stat = (name: string, ops: number) => JSON.stringify({ name, accesses: { ops, since } });

describe("createDbIndexCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue(['{"key":{"_id":1},"name":"_id_"}', '{"key":{"a":1},"name":"a_1"}', '{"key":{"b":1},"name":"b_1"}']);
    istats.mockResolvedValue([stat("_id_", 0), stat("a_1", 0), stat("b_1", 500)]);
    cs.mockImplementation(async (_s: string, _d: string, coll: string) => JSON.stringify({ indexSizes: { a_1: coll.length * 1000, b_1: 10 } }));
    (server.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 21 }));
  });

  it("sharded: the shard-key index is never listed as unused", async () => {
    (server.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 21, msg: "isdbgrid" }));
    (docs.findById as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ _id: "shop.orders", key: { a: 1 } }));
    const c = createDbIndexCheck("s", "shop", () => ["orders"]);
    await c.start();
    expect(docs.findById).toHaveBeenCalledWith("s", "config", "collections", '"shop.orders"');
    expect(c.rows).toEqual([]);
  });

  it("reports the fewest days of usage data (restart → low confidence)", async () => {
    const recent = { $date: { $numberLong: String(Date.now() - 2 * 86_400_000) } };
    istats.mockImplementation(async (_s: string, _d: string, coll: string) =>
      coll === "fresh" ? [JSON.stringify({ name: "a_1", accesses: { ops: 0, since: recent } })] : [stat("a_1", 0)]);
    const c = createDbIndexCheck("s", "shop", () => ["orders", "fresh"]);
    await c.start();
    expect(c.minDays).toBe(2);
  });

  it("lists only unused/rare indexes across collections, biggest first, skipping system.*", async () => {
    const c = createDbIndexCheck("s", "shop", () => ["orders", "users", "system.views"]);
    await c.start();
    expect(list).toHaveBeenCalledTimes(2);
    expect(c.rows.map((r) => `${r.coll}.${r.info.name}`)).toEqual(["orders.a_1", "users.a_1"]);
    expect(c.done).toBe(2);
    expect(c.total).toBe(2);
    expect(c.running).toBe(false);
  });

  it("never more than 4 collections in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    list.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [];
    });
    const c = createDbIndexCheck("s", "shop", () => Array.from({ length: 12 }, (_, i) => `c${i}`));
    await c.start();
    expect(peak).toBe(4);
    expect(c.done).toBe(12);
  });

  it("cancel stops scheduling and ignores late results", async () => {
    const resolvers: (() => void)[] = [];
    list.mockImplementation(() => new Promise((r) => resolvers.push(() => r(['{"key":{"a":1},"name":"a_1"}']))));
    const c = createDbIndexCheck("s", "shop", () => Array.from({ length: 10 }, (_, i) => `c${i}`));
    const p = c.start();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    c.cancel();
    resolvers.forEach((r) => r());
    await p;
    expect(list).toHaveBeenCalledTimes(4);
    expect(c.rows).toEqual([]);
    expect(c.running).toBe(false);
  });

  it("one failing collection (e.g. a view) doesn't stop the rest", async () => {
    list.mockImplementation(async (_s: string, _d: string, coll: string) => {
      if (coll === "v") throw { kind: "Query", message: "is a view" };
      return ['{"key":{"a":1},"name":"a_1"}'];
    });
    const c = createDbIndexCheck("s", "shop", () => ["v", "orders"]);
    await c.start();
    expect(c.failed).toEqual(["v"]);
    expect(c.rows.map((r) => r.coll)).toEqual(["orders"]);
  });
});
