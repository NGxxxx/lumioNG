import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  aggregate: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A" }]),
  deleteDocument: vi.fn(async () => {}),
  fetchFullDoc: vi.fn(async () => ({ _id: { $oid: "1" }, name: "A" })),
  exportQuery: vi.fn(async () => []),
  exportBson: vi.fn(async () => 0),
  deleteMany: vi.fn(async () => 0),
}));
// Note: api/files is no longer imported by queryRun.svelte.ts (export now opens the wizard in-memory).

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

describe("queryRun source + menu", () => {
  it("captures source db/coll after a run", async () => {
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    expect(r.srcDb).toBe("mydb");
    expect(r.srcColl).toBe("people");
  });

  it("menu offers edit/delete only when the row has _id", async () => {
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    r.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as unknown as MouseEvent, 0, "name");
    const labels = r.menuItems().map((m) => m.action);
    expect(labels).toContain("open");
    expect(labels).toContain("deleteSelected");
    expect(labels).toContain("copy");
    expect(labels).toContain("export");
  });

  it("onMenuSelect deleteSelected requests confirmation then deletes and clears selection", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([{ _id: { $oid: "abc123" }, name: "Test" }]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    r.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as unknown as MouseEvent, 0, "_id");
    r.onMenuSelect("deleteSelected");
    // confirmation dialog should be pending
    expect(r.confirmDelete).not.toBeNull();
    expect(r.confirmDelete!.count).toBe(1);
    // confirm the delete
    await r.confirmDeleteRun();
    expect(vi.mocked(api.deleteMany)).toHaveBeenCalledOnce();
    expect(r.selected.size).toBe(0);
    expect(r.confirmDelete).toBeNull();
  });

  it("exportSelected sets exportRequest to the picked rows and exportInput returns scopedMemory", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "a1" }, name: "Alice" },
      { _id: { $oid: "b2" }, name: "Bob" },
    ]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    // select row 0 only
    r.clickRow(0, { ctrl: false, shift: false });
    r.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as unknown as MouseEvent, 0, "_id");
    r.onMenuSelect("exportSelected");
    // exportRequest holds the picked row
    expect(r.exportRequest).not.toBeNull();
    expect(r.exportRequest!.rows.length).toBe(1);
    // exportInput returns a scopedMemory input
    const input = r.exportInput();
    expect(input).not.toBeNull();
    expect(input!.mode).toBe("scopedMemory");
    const sm = input as Extract<NonNullable<typeof input>, { mode: "scopedMemory" }>;
    expect(sm.coll).toBe("people");
    expect(sm.docs.length).toBe(1);
    expect(sm.columns.every((c) => c.visible)).toBe(true);
    // cancelExport clears the request
    r.cancelExport();
    expect(r.exportRequest).toBeNull();
    expect(r.exportInput()).toBeNull();
  });

  it("exportAll sets exportRequest to all docs", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "a1" }, name: "Alice" },
      { _id: { $oid: "b2" }, name: "Bob" },
    ]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    r.clickRow(0, { ctrl: false, shift: false });
    r.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as unknown as MouseEvent, 0, "_id");
    r.onMenuSelect("exportAll");
    expect(r.exportRequest).not.toBeNull();
    expect(r.exportRequest!.rows.length).toBe(2); // all docs
    const input = r.exportInput();
    expect(input!.mode).toBe("scopedMemory");
    const sm = input as Extract<NonNullable<typeof input>, { mode: "scopedMemory" }>;
    expect(sm.docs.length).toBe(2);
  });

  it("canExport is false before a run and true once there are results", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([{ _id: { $oid: "a1" } }]);
    const r = createQueryRun("db.people.aggregate([])");
    expect(r.canExport).toBe(false);
    await r.run("mydb");
    expect(r.canExport).toBe(true);
  });

  it("requestExport (toolbar) exports all results when nothing is selected", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "a1" }, name: "Alice" },
      { _id: { $oid: "b2" }, name: "Bob" },
    ]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    r.requestExport();
    expect(r.exportRequest).not.toBeNull();
    expect(r.exportRequest!.rows.length).toBe(2);
  });

  it("requestExport (toolbar) exports only the selected rows when a selection exists", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "a1" }, name: "Alice" },
      { _id: { $oid: "b2" }, name: "Bob" },
    ]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    r.clickRow(1, { ctrl: false, shift: false });
    r.requestExport();
    expect(r.exportRequest!.rows.length).toBe(1);
    expect(r.exportRequest!.rows[0].name).toBe("Bob");
  });

  it("deleteSelected is disabled when any selected row lacks _id (mixed selection)", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "aaa" }, name: "WithId" },
      { name: "NoId" },
    ]);
    const r = createQueryRun("db.people.aggregate([])");
    await r.run("mydb");
    // select row 0 (has _id), then ctrl-click row 1 (no _id)
    r.clickRow(0, { ctrl: false, shift: false });
    r.clickRow(1, { ctrl: true, shift: false });
    // open menu on row 0 (which has _id) — without this fix, disabled would be false
    r.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as unknown as MouseEvent, 0, "name");
    const deleteItem = r.menuItems().find((m) => m.action === "deleteSelected");
    expect(deleteItem).toBeDefined();
    expect(deleteItem!.disabled).toBe(true);
  });
});
