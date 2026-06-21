// src/lib/stores/connections.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/connections", () => ({
  listConnections: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("../api/connection", () => ({ connect: vi.fn() }));

import * as conns from "../api/connections";
import * as conn from "../api/connection";
import type { SavedConnection } from "../api/connections";
import { createConnectionRegistry } from "./connections.svelte";
import { commandLog } from "./commandLog.svelte";
import { obfuscate, deobfuscate } from "../domain/secret";

const list = conns.listConnections as ReturnType<typeof vi.fn>;
const save = conns.saveConnection as ReturnType<typeof vi.fn>;
const del = conns.deleteConnection as ReturnType<typeof vi.fn>;
const connect = conn.connect as ReturnType<typeof vi.fn>;

function saved(over: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 1, label: "Local", scheme: "mongodb", host: "localhost", port: 27017,
    authMethod: "none", user: "", passwordEnc: "", authSource: "", replicaSet: "",
    tls: false, extraOptions: "", ...over,
  };
}

describe("createConnectionRegistry", () => {
  beforeEach(() => { vi.clearAllMocks(); commandLog.clear(); });

  it("load fills the list (no migration when already structured)", async () => {
    list.mockResolvedValueOnce([saved()]);
    const r = createConnectionRegistry();
    await r.load();
    expect(r.list.length).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("load migrates a legacy uri entry via parse + write-back", async () => {
    list.mockResolvedValueOnce([
      { id: 1, label: "Old", scheme: "", host: "", port: null, authMethod: "none",
        user: "", passwordEnc: "", authSource: "", replicaSet: "", tls: false,
        extraOptions: "", uri: "mongodb://bob:hunter2@h:27017/?authSource=admin" } as SavedConnection,
    ]);
    save.mockResolvedValueOnce([saved({ host: "h", user: "bob", authMethod: "password" })]);
    const r = createConnectionRegistry();
    await r.load();
    expect(save).toHaveBeenCalledTimes(1);
    const [id, input] = save.mock.calls[0];
    expect(id).toBe(1);
    expect(input.host).toBe("h");
    expect(input.user).toBe("bob");
    expect(input.authSource).toBe("admin");
    expect(deobfuscate(input.passwordEnc)).toBe("hunter2");
    expect(input.passwordEnc).not.toContain("hunter2");
  });

  it("save invalid → formError, no api call", async () => {
    const r = createConnectionRegistry();
    r.label = "";
    await r.save();
    expect(r.formError).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("save valid → obfuscates password and clears form", async () => {
    save.mockResolvedValueOnce([saved()]);
    const r = createConnectionRegistry();
    r.label = "L"; r.host = "localhost"; r.authMethod = "password"; r.user = "bob"; r.password = "s3cret";
    await r.save();
    const [id, input] = save.mock.calls[0];
    expect(id).toBeNull();
    expect(deobfuscate(input.passwordEnc)).toBe("s3cret");
    expect(input.passwordEnc).not.toContain("s3cret");
    expect(r.editingId).toBeNull();
    expect(r.label).toBe("");
  });

  it("edit loads fields and deobfuscates the password", async () => {
    const r = createConnectionRegistry();
    r.edit(saved({ id: 7, label: "Old", host: "h", authMethod: "password", user: "u", passwordEnc: obfuscate("pw") }));
    expect(r.editingId).toBe(7);
    expect(r.host).toBe("h");
    expect(r.password).toBe("pw");
  });

  it("connectTo builds the URI from fields and logs it masked", async () => {
    connect.mockResolvedValueOnce(undefined);
    const r = createConnectionRegistry();
    r.host = "h"; r.port = 27017; r.authMethod = "password"; r.user = "bob"; r.password = "hunter2";
    const ok = await r.connectTo();
    expect(ok).toBe(true);
    expect(connect).toHaveBeenCalledWith("mongodb://bob:hunter2@h:27017/");
    const logged = commandLog.entries.at(-1)!.text;
    expect(logged).toContain("mongodb://bob:****@h:27017");
    expect(logged).not.toContain("hunter2");
  });

  it("importFromUri fills fields and password", () => {
    const r = createConnectionRegistry();
    r.importFromUri("mongodb+srv://u:p@cluster.example.net/?replicaSet=rs0");
    expect(r.scheme).toBe("mongodb+srv");
    expect(r.host).toBe("cluster.example.net");
    expect(r.user).toBe("u");
    expect(r.password).toBe("p");
    expect(r.replicaSet).toBe("rs0");
  });

  it("remove calls deleteConnection", async () => {
    del.mockResolvedValueOnce([]);
    const r = createConnectionRegistry();
    await r.remove(3);
    expect(del).toHaveBeenCalledWith(3);
  });
});
