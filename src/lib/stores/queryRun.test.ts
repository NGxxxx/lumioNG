import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  aggregate: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A" }]),
  deleteDocument: vi.fn(async () => {}),
  fetchFullDoc: vi.fn(async () => ({ _id: { $oid: "1" }, name: "A" })),
  exportQuery: vi.fn(async () => []),
  exportBson: vi.fn(async () => 0),
  deleteMany: vi.fn(async () => 0),
  sampleDocuments: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A", age: 30 }]),
  queryPage: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A" }]),
  countDocuments: vi.fn(async () => 0),
  distinct: vi.fn(async () => []),
  insertDocument: vi.fn(async () => '{ "$oid": "x" }'),
  insertMany: vi.fn(async () => ({ insertedCount: 0, insertedIds: [] })),
  updateOne: vi.fn(async () => ({ matched: 0, modified: 0 })),
  updateMany: vi.fn(async () => ({ matched: 0, modified: 0 })),
  replaceOne: vi.fn(async () => ({ matched: 0, modified: 0 })),
  deleteOne: vi.fn(async () => 0),
}));
// Note: api/files is no longer imported by queryRun.svelte.ts (export now opens the wizard in-memory).

import * as api from "../api/documents";
import { createQueryRun } from "./queryRun.svelte";

const aggregate = api.aggregate as ReturnType<typeof vi.fn>;
const sampleDocuments = api.sampleDocuments as ReturnType<typeof vi.fn>;
const queryPage = api.queryPage as ReturnType<typeof vi.fn>;
const countDocuments = api.countDocuments as ReturnType<typeof vi.fn>;
const distinctFn = api.distinct as ReturnType<typeof vi.fn>;
const updateOneFn = api.updateOne as ReturnType<typeof vi.fn>;
const updateManyFn = api.updateMany as ReturnType<typeof vi.fn>;
const replaceOneFn = api.replaceOne as ReturnType<typeof vi.fn>;
const deleteOneFn = api.deleteOne as ReturnType<typeof vi.fn>;
const deleteManyFn = api.deleteMany as ReturnType<typeof vi.fn>;
const insertDocumentFn = api.insertDocument as ReturnType<typeof vi.fn>;
const insertManyFn = api.insertMany as ReturnType<typeof vi.fn>;
const STMT = 'db.getCollection("orders").aggregate([{ "$match": {} }])';

describe("createQueryRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggregate.mockResolvedValue([]);
  });

  it("parses the statement and runs with the safety cap", async () => {
    aggregate.mockResolvedValueOnce([{ _id: 1 }, { _id: 2 }]);
    const v = createQueryRun("conn:1", STMT);
    await v.run("shop");
    expect(aggregate).toHaveBeenCalledWith("conn:1", "shop", "orders", '[{ "$match": {} }]', 200);
    expect(v.docs.length).toBe(2);
    expect(v.columns.length).toBeGreaterThan(0);
    expect(v.capped).toBe(false);
    expect(v.ran).toBe(true);
  });

  it("respects a trailing $limit (no injected cap)", async () => {
    const v = createQueryRun("conn:1", 'db.getCollection("orders").aggregate([{ "$limit": 5 }])');
    await v.run("shop");
    expect(aggregate).toHaveBeenCalledWith("conn:1", "shop", "orders", '[{ "$limit": 5 }]', null);
  });

  it("flags capped when the result hits the cap", async () => {
    aggregate.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ _id: i })));
    const v = createQueryRun("conn:1", STMT);
    await v.run("shop");
    expect(v.capped).toBe(true);
  });

  it("errors without a database and does not call aggregate", async () => {
    const v = createQueryRun("conn:1", STMT);
    await v.run(null);
    expect(aggregate).not.toHaveBeenCalled();
    expect(v.error).toContain("database");
  });

  it("surfaces a parse error", async () => {
    const v = createQueryRun("conn:1", "select * from orders");
    await v.run("shop");
    expect(aggregate).not.toHaveBeenCalled();
    expect(v.error).toBeTruthy();
  });

  it("pages client-side", async () => {
    aggregate.mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => ({ _id: i })));
    const v = createQueryRun("conn:1", STMT);
    await v.run("shop");
    v.setPageSize(50);
    expect(v.pageCount).toBe(3);
    expect(v.pageDocs.length).toBe(50);
    v.goToPage(3);
    expect(v.pageDocs.length).toBe(20);
  });

  it("derives and overrides column widths", async () => {
    aggregate.mockResolvedValueOnce([{ _id: 1, name: "x" }]);
    const v = createQueryRun("conn:1", STMT);
    await v.run("shop");
    expect(v.colWidths._id).toBeGreaterThan(0);
    v.setColWidth("name", 300);
    expect(v.colWidths.name).toBe(300);
  });
});

describe("queryRun source + menu", () => {
  it("captures source db/coll after a run", async () => {
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
    await r.run("mydb");
    expect(r.srcDb).toBe("mydb");
    expect(r.srcColl).toBe("people");
  });

  it("menu offers edit/delete only when the row has _id", async () => {
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
    expect(r.canExport).toBe(false);
    await r.run("mydb");
    expect(r.canExport).toBe(true);
  });

  it("requestExport (toolbar) exports all results when nothing is selected", async () => {
    vi.mocked(aggregate).mockResolvedValueOnce([
      { _id: { $oid: "a1" }, name: "Alice" },
      { _id: { $oid: "b2" }, name: "Bob" },
    ]);
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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
    const r = createQueryRun("conn:1", "db.people.aggregate([])");
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

describe("find + count routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryPage.mockResolvedValue([]);
    countDocuments.mockResolvedValue(0);
  });

  it("routes find to queryPage with skip/limit/sort/projection and caps at 200", async () => {
    queryPage.mockResolvedValueOnce([{ _id: 1 }, { _id: 2 }]);
    const v = createQueryRun("conn:1", 'db.getCollection("orders").find({ "a": 1 }, { "a": 1 }).sort({ "a": -1 }).skip(5)');
    await v.run("shop");
    expect(queryPage).toHaveBeenCalledWith("conn:1", "shop", "orders", 5, 200, '{ "a": 1 }', '{ "a": -1 }', '{ "a": 1 }');
    expect(v.resultKind).toBe("docs");
    expect(v.docs.length).toBe(2);
    expect(v.capped).toBe(false);
  });

  it("flags capped when find hits the injected 200 cap (no explicit limit)", async () => {
    queryPage.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ _id: i })));
    const v = createQueryRun("conn:1", "db.orders.find({})");
    await v.run("shop");
    expect(v.capped).toBe(true);
  });

  it("respects an explicit .limit and does not flag capped", async () => {
    queryPage.mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ _id: i })));
    const v = createQueryRun("conn:1", "db.orders.find({}).limit(10)");
    await v.run("shop");
    expect(queryPage).toHaveBeenCalledWith("conn:1", "shop", "orders", 0, 10, "{}", null, null);
    expect(v.capped).toBe(false);
  });

  it("runNoLimit passes limit 0 for find", async () => {
    const v = createQueryRun("conn:1", "db.orders.find({})");
    await v.runNoLimit("shop");
    expect(queryPage).toHaveBeenCalledWith("conn:1", "shop", "orders", 0, 0, "{}", null, null);
  });

  it("routes count to countDocuments and renders a scalar", async () => {
    countDocuments.mockResolvedValueOnce(42);
    const v = createQueryRun("conn:1", 'db.orders.countDocuments({ "a": 1 })');
    await v.run("shop");
    expect(countDocuments).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }');
    expect(v.resultKind).toBe("scalar");
    expect(v.countResult).toBe(42);
    expect(v.docs.length).toBe(0);
    expect(v.srcColl).toBe("orders");
  });
});

describe("distinct routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distinctFn.mockResolvedValue([]);
  });

  it("routes distinct to api.distinct and renders values", async () => {
    distinctFn.mockResolvedValueOnce(["active", "pending", "archived"]);
    const v = createQueryRun("conn:1", 'db.orders.distinct("status", { "a": 1 })');
    await v.run("shop");
    expect(distinctFn).toHaveBeenCalledWith("conn:1", "shop", "orders", "status", '{ "a": 1 }');
    expect(v.resultKind).toBe("values");
    expect(v.distinctValues).toEqual(["active", "pending", "archived"]);
    expect(v.docs.length).toBe(0);
    expect(v.srcColl).toBe("orders");
  });
});

describe("fieldsFor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sampleDocuments.mockResolvedValue([{ _id: { $oid: "1" }, name: "A", age: 30 }]);
  });

  it("samples once and infers field paths", async () => {
    const v = createQueryRun("conn:1", STMT);
    const fields = await v.fieldsFor("shop", "orders");
    expect(sampleDocuments).toHaveBeenCalledWith("conn:1", "shop", "orders", "{}", 50);
    expect(fields).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("caches per (db, coll): repeated calls do not re-sample", async () => {
    const v = createQueryRun("conn:1", STMT);
    await v.fieldsFor("shop", "orders");
    await v.fieldsFor("shop", "orders");
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("samples separately for a different collection", async () => {
    const v = createQueryRun("conn:1", STMT);
    await v.fieldsFor("shop", "orders");
    await v.fieldsFor("shop", "users");
    expect(sampleDocuments).toHaveBeenCalledTimes(2);
  });

  it("de-dupes concurrent calls for the same key", async () => {
    const v = createQueryRun("conn:1", STMT);
    await Promise.all([v.fieldsFor("shop", "orders"), v.fieldsFor("shop", "orders")]);
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("returns [] when sampling fails", async () => {
    sampleDocuments.mockRejectedValueOnce(new Error("boom"));
    const v = createQueryRun("conn:1", STMT);
    expect(await v.fieldsFor("shop", "orders")).toEqual([]);
  });
});

describe("write routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateOneFn.mockResolvedValue({ matched: 0, modified: 0 });
    updateManyFn.mockResolvedValue({ matched: 0, modified: 0 });
    replaceOneFn.mockResolvedValue({ matched: 0, modified: 0 });
    deleteOneFn.mockResolvedValue(0);
    deleteManyFn.mockResolvedValue(0);
    insertDocumentFn.mockResolvedValue('{ "$oid": "x" }');
    insertManyFn.mockResolvedValue({ insertedCount: 0, insertedIds: [] });
  });

  it("defers a write to pendingWrite without calling the api", async () => {
    const v = createQueryRun("conn:1", 'db.orders.updateOne({ "a": 1 }, { "$set": { "b": 2 } })');
    await v.run("shop");
    expect(updateOneFn).not.toHaveBeenCalled();
    expect(v.pendingWrite).not.toBeNull();
    expect(v.pendingWrite!.parsed.kind).toBe("updateOne");
    expect(v.resultKind).toBe("docs"); // unchanged until confirmed
  });

  it("confirmWrite runs updateOne with allowAll=true and builds an ack", async () => {
    updateOneFn.mockResolvedValueOnce({ matched: 3, modified: 2 });
    const v = createQueryRun("conn:1", 'db.orders.updateOne({ "a": 1 }, { "$set": { "b": 2 } })');
    await v.run("shop");
    await v.confirmWrite();
    expect(updateOneFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }', '{ "$set": { "b": 2 } }', true);
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("updateOne");
    expect(v.ackResult!.fields.map((f) => f.value)).toEqual(["3", "2"]);
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("confirmWrite runs deleteMany with an empty filter (allowAll=true)", async () => {
    deleteManyFn.mockResolvedValueOnce(7);
    const v = createQueryRun("conn:1", "db.orders.deleteMany({})");
    await v.run("shop");
    await v.confirmWrite();
    expect(deleteManyFn).toHaveBeenCalledWith("conn:1", "shop", "orders", "{}", true);
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.fields[0].value).toBe("7");
  });

  it("confirmWrite runs insertOne and builds an ack with the inserted id", async () => {
    insertDocumentFn.mockResolvedValueOnce('{ "$oid": "abc123" }');
    const v = createQueryRun("conn:1", 'db.orders.insertOne({ "a": 1 })');
    await v.run("shop");
    await v.confirmWrite();
    expect(insertDocumentFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }');
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("insertOne");
    expect(v.ackResult!.fields[0].value).toBe('{ "$oid": "abc123" }');
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("confirmWrite runs insertMany and builds an ack with the inserted count", async () => {
    insertManyFn.mockResolvedValueOnce({ insertedCount: 2, insertedIds: ["id1", "id2"] });
    const v = createQueryRun("conn:1", 'db.orders.insertMany([{ "a": 1 }, { "b": 2 }])');
    await v.run("shop");
    await v.confirmWrite();
    expect(insertManyFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '[{ "a": 1 }, { "b": 2 }]');
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("insertMany");
    expect(v.ackResult!.fields[0].value).toBe("2");
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("confirmWrite runs updateMany with allowAll=true and builds an ack with matched/modified", async () => {
    updateManyFn.mockResolvedValueOnce({ matched: 5, modified: 4 });
    const v = createQueryRun("conn:1", 'db.orders.updateMany({ "a": 1 }, { "$set": { "b": 2 } })');
    await v.run("shop");
    await v.confirmWrite();
    expect(updateManyFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }', '{ "$set": { "b": 2 } }', true);
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("updateMany");
    expect(v.ackResult!.fields.map((f) => f.value)).toEqual(["5", "4"]);
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("confirmWrite runs replaceOne with allowAll=true and builds an ack with matched/modified", async () => {
    replaceOneFn.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createQueryRun("conn:1", 'db.orders.replaceOne({ "a": 1 }, { "a": 2 })');
    await v.run("shop");
    await v.confirmWrite();
    expect(replaceOneFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }', '{ "a": 2 }', true);
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("replaceOne");
    expect(v.ackResult!.fields.map((f) => f.value)).toEqual(["1", "1"]);
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("confirmWrite runs deleteOne with allowAll=true and builds an ack with deleted count", async () => {
    deleteOneFn.mockResolvedValueOnce(1);
    const v = createQueryRun("conn:1", 'db.orders.deleteOne({ "a": 1 })');
    await v.run("shop");
    await v.confirmWrite();
    expect(deleteOneFn).toHaveBeenCalledWith("conn:1", "shop", "orders", '{ "a": 1 }', true);
    expect(v.resultKind).toBe("ack");
    expect(v.ackResult!.op).toBe("deleteOne");
    expect(v.ackResult!.fields[0].value).toBe("1");
    expect(v.pendingWrite).toBeNull();
    expect(v.srcColl).toBe("orders");
  });

  it("cancelWrite clears pendingWrite without running anything", async () => {
    const v = createQueryRun("conn:1", "db.orders.deleteMany({})");
    await v.run("shop");
    v.cancelWrite();
    expect(v.pendingWrite).toBeNull();
    expect(deleteManyFn).not.toHaveBeenCalled();
  });
});
