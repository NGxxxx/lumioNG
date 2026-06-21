import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/stats", () => ({ collStats: vi.fn(), dbStats: vi.fn(), collOptions: vi.fn() }));

import * as api from "../api/stats";
import { createDatabaseCollections } from "./databaseCollections.svelte";

const collStats = api.collStats as ReturnType<typeof vi.fn>;
const dbStats = api.dbStats as ReturnType<typeof vi.fn>;

const tree = { databases: [{ name: "shop", collections: ["users", "orders"] }] };

describe("createDatabaseCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStats.mockResolvedValue(JSON.stringify({ db: "shop", collections: { $numberInt: "2" } }));
    collStats.mockResolvedValue(JSON.stringify({ ns: "shop.users", count: { $numberInt: "5" } }));
  });

  it("init lists rows from the tree and loads the dbStats summary", async () => {
    const v = createDatabaseCollections("shop", tree);
    await v.init();
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]); // name asc default
    expect(v.rows.every((r) => r.state === "idle")).toBe(true);
    expect(v.summary?.collections).toBe(2);
  });

  it("loadStats fills one row", async () => {
    const v = createDatabaseCollections("shop", tree);
    await v.init();
    await v.loadStats("users");
    const row = v.rows.find((r) => r.name === "users")!;
    expect(collStats).toHaveBeenCalledWith("shop", "users");
    expect(row.state).toBe("loaded");
    expect(row.stats?.count).toBe(5);
  });

  it("setSort toggles direction and sorts by count with nulls last", async () => {
    collStats
      .mockResolvedValueOnce(JSON.stringify({ ns: "shop.orders", count: { $numberInt: "9" } }));
    const v = createDatabaseCollections("shop", tree);
    await v.init();
    await v.loadStats("orders"); // users stays idle (count null)
    v.setSort("count");          // asc → nulls last → orders(9) first, users(null) last
    expect(v.rows.map((r) => r.name)).toEqual(["orders", "users"]);
    v.setSort("count");          // toggle desc
    expect(v.sortDir).toBe("desc");
  });

  it("loadStats error sets row error state", async () => {
    collStats.mockRejectedValueOnce({ kind: "Query", message: "nope" });
    const v = createDatabaseCollections("shop", tree);
    await v.init();
    await v.loadStats("users");
    const row = v.rows.find((r) => r.name === "users")!;
    expect(row.state).toBe("error");
    expect(row.error).toContain("nope");
  });
});
