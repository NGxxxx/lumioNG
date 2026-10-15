import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/indexes", () => ({
  listIndexes: vi.fn(),
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
  indexStats: vi.fn(),
  setIndexHidden: vi.fn(),
}));
vi.mock("../api/stats", () => ({ collStats: vi.fn() }));
vi.mock("../api/mongoServer", () => ({ isMaster: vi.fn() }));
vi.mock("../api/documents", () => ({ findById: vi.fn() }));
import * as statsApi from "../api/stats";
import * as serverApi from "../api/mongoServer";
import * as docsApi from "../api/documents";

import * as api from "../api/indexes";
import { createIndexView } from "./indexView.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { dropIndexCmd, listIndexesCmd } from "../domain/mongosh";

const listIdx = api.listIndexes as ReturnType<typeof vi.fn>;
const createIdx = api.createIndex as ReturnType<typeof vi.fn>;
const dropIdx = api.dropIndex as ReturnType<typeof vi.fn>;

const emailIdx =
  '{"v":{"$numberInt":"2"},"key":{"email":{"$numberInt":"1"}},"name":"email_1","unique":true}';

describe("createIndexView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIdx.mockResolvedValue([]);
    (api.indexStats as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (statsApi.collStats as ReturnType<typeof vi.fn>).mockResolvedValue("{}");
    (serverApi.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 21 }));
  });

  it("init loads and parses the index list", async () => {
    listIdx.mockResolvedValueOnce([emailIdx]);
    const v = createIndexView("conn:1", "d", "c");
    await v.init();
    expect(v.indexes).toHaveLength(1);
    expect(v.indexes[0].name).toBe("email_1");
    expect(v.indexes[0].unique).toBe(true);
  });

  it("create with valid fields: validate → buildKeys → api → refresh", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.create([{ field: "email", dir: 1 }], true, null, false, null, "", "");
    expect(createIdx).toHaveBeenCalledWith("conn:1", "d", "c", '{"email":1}', true, null, false, null, null, null);
    expect(listIdx).toHaveBeenCalled();
  });

  it("create with invalid field → throws, api not called", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await expect(v.create([{ field: "  ", dir: 1 }], false, null, false, null, "", "")).rejects.toBeTruthy();
    expect(createIdx).not.toHaveBeenCalled();
  });

  it("create with blank name → sends null after trimming", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.create([{ field: "email", dir: 1 }], false, "   ", false, null, "", "");
    expect(createIdx).toHaveBeenCalledWith("conn:1", "d", "c", '{"email":1}', false, null, false, null, null, null);
  });

  it("create with sparse + TTL + partial filter + collation forwards them all", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.create(
      [{ field: "createdAt", dir: 1 }], false, null, true, 3600,
      '{"status":"active"}', '{"locale":"en","strength":2}',
    );
    expect(createIdx).toHaveBeenCalledWith(
      "conn:1", "d", "c", '{"createdAt":1}', false, null, true, 3600,
      '{"status":"active"}', '{"locale":"en","strength":2}',
    );
  });

  it("create with blank partial filter / collation → sends null, not empty string", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.create([{ field: "email", dir: 1 }], false, null, false, null, "   ", "");
    expect(createIdx).toHaveBeenCalledWith("conn:1", "d", "c", '{"email":1}', false, null, false, null, null, null);
  });

  it("drop calls api and refreshes", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.drop("email_1");
    expect(dropIdx).toHaveBeenCalledWith("conn:1", "d", "c", "email_1");
    expect(listIdx).toHaveBeenCalled();
  });

  it("refresh error sets error and does not throw", async () => {
    listIdx.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createIndexView("conn:1", "d", "c");
    await v.refresh();
    expect(v.error).toContain("boom");
  });
});

describe("indexView command log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIdx.mockResolvedValue([]);
    commandLog.clear();
  });

  it("drop pushes dropIndexCmd to the command log with a measured duration", async () => {
    dropIdx.mockResolvedValueOnce(undefined);
    listIdx.mockResolvedValueOnce([]);
    const v = createIndexView("conn:1", "d", "c");
    await v.drop("age_1");
    const entry = commandLog.entries.find((e) => e.text === dropIndexCmd("c", "age_1"));
    expect(entry).toBeDefined();
    expect(entry!.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("refresh pushes listIndexesCmd with a measured duration", async () => {
    listIdx.mockResolvedValueOnce([]);
    const v = createIndexView("conn:1", "d", "c");
    await v.refresh();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });
});

describe("indexView activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIdx.mockResolvedValue([]);
  });

  it("refresh reports busy while listIndexes is in flight", async () => {
    let sawBusy = false;
    listIdx.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
      return [];
    });
    const v = createIndexView("conn:1", "d", "c");
    await v.refresh();
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });

  it("create with invalid partial-filter JSON does not leak the activity counter", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await expect(
      v.create([{ field: "email", dir: 1 }], false, null, false, null, "{not valid json", ""),
    ).rejects.toBeTruthy();
    expect(activity.busy).toBe(false);
  });

  it("create with invalid collation JSON does not leak the activity counter", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await expect(
      v.create([{ field: "email", dir: 1 }], false, null, false, null, "", "{not valid json"),
    ).rejects.toBeTruthy();
    expect(activity.busy).toBe(false);
  });

  describe("usage, sizes, hide", () => {
    const DAY = 86_400_000;
    const since = (days: number) => ({ $date: { $numberLong: String(Date.now() - days * DAY) } });
    const idx = (name: string, extra = "") => `{"v":2,"key":{"${name.replace(/_1$/, "")}":1},"name":"${name}"${extra}}`;
    const stat = (name: string, ops: number, days = 30) => JSON.stringify({ name, accesses: { ops: { $numberLong: String(ops) }, since: since(days) } });
    const stats = api.indexStats as ReturnType<typeof vi.fn>;
    const hide = api.setIndexHidden as ReturnType<typeof vi.fn>;
    const cs = statsApi.collStats as ReturnType<typeof vi.fn>;

    beforeEach(() => {
      listIdx.mockResolvedValue(['{"v":2,"key":{"_id":1},"name":"_id_"}', idx("a_1"), idx("b_1"), idx("c_1", ',"unique":true')]);
      stats.mockResolvedValue([stat("_id_", 0), stat("a_1", 0), stat("b_1", 900), stat("c_1", 0)]);
      cs.mockResolvedValue(JSON.stringify({ indexSizes: { _id_: 1000, a_1: 340_000_000, b_1: 2000, c_1: 500 } }));
      (serverApi.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 21 }));
    });

    it("rows put unused first; summary counts only unprotected unused", async () => {
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      expect(v.rows[0].info.name).toBe("a_1");
      expect(v.rows[0].status).toBe("unused");
      expect(v.rows.find((r) => r.info.name === "c_1")?.status).toBe("protectedUnique");
      expect(v.summary).toEqual({ count: 1, bytes: 340_000_000 });
      expect(v.dataDays).toBe(30);
    });

    it("$indexStats refused → tab still loads with sizes, usage error set", async () => {
      stats.mockRejectedValue({ kind: "Query", message: "not authorized" });
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      expect(v.error).toBeNull();
      expect(v.usageError).toMatch(/not authorized/);
      expect(v.rows.find((r) => r.info.name === "a_1")?.size).toBe(340_000_000);
      expect(v.dataDays).toBeNull();
    });

    it("hide asks first, then hides and refreshes; unhide is one call", async () => {
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      v.requestHide("a_1");
      expect(v.pendingHide).toBe("a_1");
      expect(hide).not.toHaveBeenCalled();
      await v.confirmHide();
      expect(hide).toHaveBeenCalledWith("conn:1", "d", "c", "a_1", true);
      expect(listIdx).toHaveBeenCalledTimes(2);
      await v.unhide("a_1");
      expect(hide).toHaveBeenLastCalledWith("conn:1", "d", "c", "a_1", false);
    });

    it("protected indexes and servers below 4.4 cannot hide", async () => {
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      v.requestHide("c_1");
      expect(v.pendingHide).toBeNull();
      (serverApi.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 8 }));
      const old = createIndexView("conn:1", "d", "c");
      await old.init();
      expect(old.traits.canHide).toBe(false);
      old.requestHide("a_1");
      expect(old.pendingHide).toBeNull();
    });

    it("Drop on a hideable index suggests hiding first; either path works", async () => {
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      v.requestDrop("a_1");
      expect(v.dropAdvice).toBe("a_1");
      expect(v.destructive.pending).toBeFalsy();
      await v.hideInstead();
      expect(hide).toHaveBeenCalledWith("conn:1", "d", "c", "a_1", true);
      v.requestDrop("a_1");
      v.dropAnyway();
      expect(v.dropAdvice).toBeNull();
      expect(v.destructive.pending).toBeTruthy();
    });

    it("sharded: shard key read from config.collections protects its index", async () => {
      (serverApi.isMaster as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ maxWireVersion: 21, msg: "isdbgrid" }));
      (docsApi.findById as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ _id: "d.c", key: { a: 1 } }));
      const v = createIndexView("conn:1", "d", "c");
      await v.init();
      expect(docsApi.findById).toHaveBeenCalledWith("conn:1", "config", "collections", '"d.c"');
      expect(v.rows.find((r) => r.info.name === "a_1")?.status).toBe("protectedShardKey");
      expect(v.traits.topology).toBe("sharded");
    });
  });
});
