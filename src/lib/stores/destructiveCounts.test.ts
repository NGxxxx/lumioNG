import { describe, it, expect, vi } from "vitest";
vi.mock("../api/stats", () => ({
  collStats: vi.fn().mockResolvedValue('{"ns":"shop.orders","count":{"$numberInt":"48213"},"size":{"$numberLong":"9000000"}}'),
  dbStats: vi.fn().mockResolvedValue('{"db":"shop","collections":7,"objects":{"$numberLong":"120000"}}'),
}));
import { collStats } from "../api/stats";
import { countCollection, countDatabase } from "./destructiveCounts";

describe("destructiveCounts", () => {
  it("collection: count + size", async () => {
    expect(await countCollection("s", "shop", "orders")).toEqual({ count: 48213, bytes: 9000000 });
  });
  it("database: objects + collections", async () => {
    expect(await countDatabase("s", "shop")).toEqual({ count: 120000, collections: 7 });
  });
  it("no count → throws (the gate escalates)", async () => {
    vi.mocked(collStats).mockResolvedValueOnce('{"ns":"x"}');
    await expect(countCollection("s", "d", "c")).rejects.toThrow();
  });
});
