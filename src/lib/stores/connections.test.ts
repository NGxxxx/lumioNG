import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/connections", () => ({
  listConnections: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("../api/connection", () => ({ connect: vi.fn() }));

import * as conns from "../api/connections";
import * as conn from "../api/connection";
import { createConnectionRegistry } from "./connections.svelte";
import { commandLog } from "./commandLog.svelte";
import { connectCmd } from "../domain/mongosh";

const list = conns.listConnections as ReturnType<typeof vi.fn>;
const save = conns.saveConnection as ReturnType<typeof vi.fn>;
const del = conns.deleteConnection as ReturnType<typeof vi.fn>;
const connect = conn.connect as ReturnType<typeof vi.fn>;

describe("createConnectionRegistry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("load đổ list", async () => {
    list.mockResolvedValueOnce([{ id: 1, label: "Local", uri: "mongodb://localhost" }]);
    const r = createConnectionRegistry();
    await r.load();
    expect(r.list.length).toBe(1);
  });

  it("load lỗi → error set", async () => {
    list.mockRejectedValueOnce({ kind: "Io", message: "đọc file lỗi" });
    const r = createConnectionRegistry();
    await r.load();
    expect(r.error).not.toBeNull();
  });

  it("save invalid → formError, không gọi api", async () => {
    const r = createConnectionRegistry();
    r.label = "";
    r.uri = "mongodb://x";
    await r.save();
    expect(r.formError).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("save valid → gọi saveConnection và clear form", async () => {
    save.mockResolvedValueOnce([{ id: 1, label: "L", uri: "mongodb://x" }]);
    const r = createConnectionRegistry();
    r.label = "L";
    r.uri = "mongodb://x";
    await r.save();
    expect(save).toHaveBeenCalledWith(null, "L", "mongodb://x");
    expect(r.list.length).toBe(1);
    expect(r.editingId).toBeNull();
    expect(r.label).toBe("");
  });

  it("edit nạp form rồi save dùng editingId", async () => {
    save.mockResolvedValueOnce([]);
    const r = createConnectionRegistry();
    r.edit({ id: 7, label: "Old", uri: "mongodb://old" });
    expect(r.editingId).toBe(7);
    expect(r.label).toBe("Old");
    await r.save();
    expect(save).toHaveBeenCalledWith(7, "Old", "mongodb://old");
  });

  it("remove gọi deleteConnection", async () => {
    del.mockResolvedValueOnce([]);
    const r = createConnectionRegistry();
    await r.remove(3);
    expect(del).toHaveBeenCalledWith(3);
  });

  it("connectTo ok → gọi connect, trả true", async () => {
    connect.mockResolvedValueOnce(undefined);
    const r = createConnectionRegistry();
    const ok = await r.connectTo("mongodb://x");
    expect(connect).toHaveBeenCalledWith("mongodb://x");
    expect(ok).toBe(true);
  });

  it("connectTo lỗi → error set, trả false", async () => {
    connect.mockRejectedValueOnce({ kind: "Connection", message: "boom" });
    const r = createConnectionRegistry();
    const ok = await r.connectTo("mongodb://x");
    expect(ok).toBe(false);
    expect(r.error).not.toBeNull();
  });
});

describe("connections command log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("connectTo thành công đẩy connectCmd", async () => {
    connect.mockResolvedValueOnce(undefined);
    const r = createConnectionRegistry();
    await r.connectTo("mongodb://localhost:27017");
    expect(commandLog.entries.at(-1)!.text).toBe(connectCmd("mongodb://localhost:27017"));
  });
});
