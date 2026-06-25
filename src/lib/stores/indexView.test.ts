import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/indexes", () => ({
  listIndexes: vi.fn(),
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
}));

import * as api from "../api/indexes";
import { createIndexView } from "./indexView.svelte";
import { commandLog } from "./commandLog.svelte";
import { dropIndexCmd } from "../domain/mongosh";

const listIdx = api.listIndexes as ReturnType<typeof vi.fn>;
const createIdx = api.createIndex as ReturnType<typeof vi.fn>;
const dropIdx = api.dropIndex as ReturnType<typeof vi.fn>;

const emailIdx =
  '{"v":{"$numberInt":"2"},"key":{"email":{"$numberInt":"1"}},"name":"email_1","unique":true}';

describe("createIndexView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIdx.mockResolvedValue([]);
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
    await v.create([{ field: "email", dir: 1 }], true, null);
    expect(createIdx).toHaveBeenCalledWith("conn:1", "d", "c", '{"email":1}', true, null);
    expect(listIdx).toHaveBeenCalled();
  });

  it("create with invalid field → throws, api not called", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await expect(v.create([{ field: "  ", dir: 1 }], false, null)).rejects.toBeTruthy();
    expect(createIdx).not.toHaveBeenCalled();
  });

  it("create with blank name → sends null after trimming", async () => {
    const v = createIndexView("conn:1", "d", "c");
    await v.create([{ field: "email", dir: 1 }], false, "   ");
    expect(createIdx).toHaveBeenCalledWith("conn:1", "d", "c", '{"email":1}', false, null);
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

  it("drop pushes dropIndexCmd to the command log", async () => {
    dropIdx.mockResolvedValueOnce(undefined);
    listIdx.mockResolvedValueOnce([]);
    const v = createIndexView("conn:1", "d", "c");
    await v.drop("age_1");
    expect(commandLog.entries.at(-1)!.text).toBe(dropIndexCmd("c", "age_1"));
  });
});
