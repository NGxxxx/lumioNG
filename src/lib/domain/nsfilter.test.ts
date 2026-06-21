import { describe, it, expect } from "vitest";
import { filterNamespaces } from "./nsfilter";
import type { DbInfo } from "../api/connection";

const dbs: DbInfo[] = [
  { name: "shop", collections: ["users", "orders", "userLogs"] },
  { name: "userspace", collections: ["sessions"] },
  { name: "analytics", collections: ["events"] },
];

describe("filterNamespaces", () => {
  it("returns input unchanged for empty query", () => {
    const r = filterNamespaces(dbs, "  ");
    expect(r.databases).toEqual(dbs);
    expect(r.expand.size).toBe(0);
  });

  it("matches collections case-insensitively and keeps only matches", () => {
    const r = filterNamespaces(dbs, "USER");
    const shop = r.databases.find((d) => d.name === "shop");
    expect(shop?.collections).toEqual(["users", "userLogs"]);
    expect(r.expand.has("shop")).toBe(true);
  });

  it("keeps a db whose name matches with all its collections", () => {
    const r = filterNamespaces(dbs, "userspace");
    const us = r.databases.find((d) => d.name === "userspace");
    expect(us?.collections).toEqual(["sessions"]);
  });

  it("drops dbs with no name match and no collection match", () => {
    const r = filterNamespaces(dbs, "user");
    expect(r.databases.some((d) => d.name === "analytics")).toBe(false);
  });

  it("expands only dbs that matched via a collection", () => {
    const r = filterNamespaces(dbs, "sessions");
    expect(r.expand.has("userspace")).toBe(true);
    expect([...r.expand]).toEqual(["userspace"]);
  });
});
