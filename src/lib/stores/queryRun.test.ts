import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({ aggregate: vi.fn() }));

import * as api from "../api/documents";
import { createQueryRun } from "./queryRun.svelte";

const aggregate = api.aggregate as ReturnType<typeof vi.fn>;
const STMT = 'db.getCollection("orders").aggregate([{ "$match": {} }])';

describe("createQueryRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggregate.mockResolvedValue([]);
  });

  it("parses the statement and runs with the safety cap", async () => {
    aggregate.mockResolvedValueOnce([{ _id: 1 }, { _id: 2 }]);
    const v = createQueryRun(STMT);
    await v.run("shop");
    expect(aggregate).toHaveBeenCalledWith("shop", "orders", '[{ "$match": {} }]', 200);
    expect(v.docs.length).toBe(2);
    expect(v.columns.length).toBeGreaterThan(0);
    expect(v.capped).toBe(false);
    expect(v.ran).toBe(true);
  });

  it("respects a trailing $limit (no injected cap)", async () => {
    const v = createQueryRun('db.getCollection("orders").aggregate([{ "$limit": 5 }])');
    await v.run("shop");
    expect(aggregate).toHaveBeenCalledWith("shop", "orders", '[{ "$limit": 5 }]', null);
  });

  it("flags capped when the result hits the cap", async () => {
    aggregate.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ _id: i })));
    const v = createQueryRun(STMT);
    await v.run("shop");
    expect(v.capped).toBe(true);
  });

  it("errors without a database and does not call aggregate", async () => {
    const v = createQueryRun(STMT);
    await v.run(null);
    expect(aggregate).not.toHaveBeenCalled();
    expect(v.error).toContain("database");
  });

  it("surfaces a parse error", async () => {
    const v = createQueryRun('db.getCollection("x").find({})');
    await v.run("shop");
    expect(aggregate).not.toHaveBeenCalled();
    expect(v.error).toBeTruthy();
  });

  it("pages client-side", async () => {
    aggregate.mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => ({ _id: i })));
    const v = createQueryRun(STMT);
    await v.run("shop");
    v.setPageSize(50);
    expect(v.pageCount).toBe(3);
    expect(v.pageDocs.length).toBe(50);
    v.goToPage(3);
    expect(v.pageDocs.length).toBe(20);
  });

  it("derives and overrides column widths", async () => {
    aggregate.mockResolvedValueOnce([{ _id: 1, name: "x" }]);
    const v = createQueryRun(STMT);
    await v.run("shop");
    expect(v.colWidths._id).toBeGreaterThan(0);
    v.setColWidth("name", 300);
    expect(v.colWidths.name).toBe(300);
  });
});
