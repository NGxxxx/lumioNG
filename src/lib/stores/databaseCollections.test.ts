import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/stats", () => ({ collStats: vi.fn(), dbStats: vi.fn(), collOptions: vi.fn() }));

import * as api from "../api/stats";
import { createDatabaseCollections } from "./databaseCollections.svelte";
import { commandLog } from "./commandLog.svelte";

const collStats = api.collStats as ReturnType<typeof vi.fn>;
const dbStats = api.dbStats as ReturnType<typeof vi.fn>;

const tree = { databases: [{ name: "shop", collections: ["users", "orders"] }] };

describe("createDatabaseCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStats.mockResolvedValue(JSON.stringify({ db: "shop", collections: { $numberInt: "2" } }));
    collStats.mockResolvedValue(JSON.stringify({ ns: "shop.users", count: { $numberInt: "5" } }));
    commandLog.clear();
  });

  it("init lists rows from the tree and loads the dbStats summary", async () => {
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]); // name asc default
    expect(v.rows.every((r) => r.state === "idle")).toBe(true);
    expect(v.summary?.collections).toBe(2);
  });

  it("loadStats fills one row", async () => {
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    await v.loadStats("users");
    const row = v.rows.find((r) => r.name === "users")!;
    expect(collStats).toHaveBeenCalledWith("conn:1", "shop", "users");
    expect(row.state).toBe("loaded");
    expect(row.stats?.count).toBe(5);
  });

  it("setSort toggles direction and sorts by count with nulls last", async () => {
    collStats
      .mockResolvedValueOnce(JSON.stringify({ ns: "shop.orders", count: { $numberInt: "9" } }));
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    await v.loadStats("orders"); // users stays idle (count null)
    v.setSort("count");          // asc → nulls last → orders(9) first, users(null) last
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]);
    v.setSort("count");          // toggle desc
    expect(v.sortDir).toBe("desc");
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]); // nulls stay last in desc too
  });

  it("desc sort reverses order among loaded rows", async () => {
    collStats
      .mockResolvedValueOnce(JSON.stringify({ ns: "shop.orders", count: { $numberInt: "9" } }))
      .mockResolvedValueOnce(JSON.stringify({ ns: "shop.users", count: { $numberInt: "5" } }));
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    await v.loadStats("orders");
    await v.loadStats("users");
    v.setSort("count");          // asc → users(5), orders(9)
    expect(v.rows.map((r) => r.name)).toEqual(["users", "orders"]);
    v.setSort("count");          // desc → orders(9), users(5)
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]);
  });

  it("loadStats error sets row error state", async () => {
    collStats.mockRejectedValueOnce({ kind: "Query", message: "nope" });
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    await v.loadStats("users");
    const row = v.rows.find((r) => r.name === "users")!;
    expect(row.state).toBe("error");
    expect(row.error).toContain("nope");
  });

  it("init pushes dbStatsCmd with a measured duration", async () => {
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("loadStats pushes collStatsCmd with a measured duration", async () => {
    const v = createDatabaseCollections("conn:1", "shop", tree);
    await v.init();
    commandLog.clear();
    await v.loadStats("users");
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });
});
