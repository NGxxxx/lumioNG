// src/lib/stores/connections.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "keychain"),
  listConnections: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
import * as conns from "../api/connections";
import type { SavedConnection } from "../api/connections";
import { createConnectionRegistry } from "./connections.svelte";
import { commandLog } from "./commandLog.svelte";
import { obfuscate, deobfuscate } from "../domain/secret";

const list = conns.listConnections as ReturnType<typeof vi.fn>;
const save = conns.saveConnection as ReturnType<typeof vi.fn>;
const del = conns.deleteConnection as ReturnType<typeof vi.fn>;

function saved(over: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 1, label: "Local", scheme: "mongodb", host: "localhost", port: 27017,
    authMethod: "none", user: "", passwordEnc: "", authSource: "", replicaSet: "",
    tls: false, extraOptions: "", readOnly: false,
    tlsCertificateKeyFile: "", tlsCertificateKeyFilePasswordEnc: "",
    sshEnabled: false, sshHost: "", sshPort: 22, sshUser: "", sshAuthMethod: "password",
    sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "", environment: "", color: "", mcpAccess: "read", ...over,
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

  it("environment and color are edited, saved, and default to empty for old entries", async () => {
    save.mockResolvedValueOnce([saved()]);
    const r = createConnectionRegistry();
    r.edit(saved({ id: 3 }));
    expect(r.environment).toBe("");
    expect(r.color).toBe("");
    r.edit(saved({ id: 4, environment: "staging", color: "#f5a524" }));
    expect(r.environment).toBe("staging");
    r.environment = "prod";
    r.color = "#e5484d";
    await r.save();
    const [, input] = save.mock.calls[0];
    expect(input.environment).toBe("prod");
    expect(input.color).toBe("#e5484d");
    expect(r.environment).toBe("");
  });

  it("edit loads fields and deobfuscates the password", async () => {
    const r = createConnectionRegistry();
    r.edit(saved({ id: 7, label: "Old", host: "h", authMethod: "password", user: "u", passwordEnc: obfuscate("pw") }));
    expect(r.editingId).toBe(7);
    expect(r.host).toBe("h");
    expect(r.password).toBe("pw");
  });

  it("connectTo builds the URI (no backend call, logging moved to sessionManager)", () => {
    const r = createConnectionRegistry();
    r.host = "h"; r.port = 27017; r.authMethod = "password"; r.user = "bob"; r.password = "hunter2";
    const result = r.connectTo();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.uri).toContain("bob:hunter2@h:27017");
    }
    // connectCmd logging happens in sessionManager.focusOrOpen, not here
    expect(commandLog.entries.length).toBe(0);
  });

  it("fillFromUri fills the form, names it from the host, and can be undone", () => {
    const r = createConnectionRegistry();
    r.label = "";
    const res = r.fillFromUri("mongodb+srv://u:p@cluster0.abc.mongodb.net/?replicaSet=x");
    expect(res).toMatchObject({ ok: true });
    expect(r.host).toBe("cluster0.abc.mongodb.net");
    expect(r.user).toBe("u");
    expect(r.password).toBe("p");
    expect(r.replicaSet).toBe("x");
    expect(r.label).toBe("cluster0");
    expect(res.ok && res.filled).toBeGreaterThan(3);
    expect(r.canUndoFill).toBe(true);
    r.undoFill();
    expect(r.host).toBe("localhost");
    expect(r.password).toBe("");
    expect(r.label).toBe("");
    expect(r.canUndoFill).toBe(false);
  });

  it("fillFromUri rejects an invalid URI and leaves the form untouched", () => {
    const r = createConnectionRegistry();
    r.host = "keep";
    expect(r.fillFromUri("http://nope")).toEqual({ ok: false });
    expect(r.fillFromUri("mongodb://")).toEqual({ ok: false });
    expect(r.host).toBe("keep");
  });

  it("the password never ends up in the name", () => {
    const r = createConnectionRegistry();
    r.fillFromUri("mongodb://bob:s3cret@db.internal:27017/");
    expect(r.label).not.toContain("s3cret");
  });

  it("uriOf builds a URI without the password unless asked", () => {
    const r = createConnectionRegistry();
    const c = saved({ host: "h", authMethod: "password", user: "bob", passwordEnc: obfuscate("pw") });
    expect(r.uriOf(c, false)).not.toContain("pw@");
    expect(r.uriOf(c, false)).toContain("bob@h");
    expect(r.uriOf(c, true)).toContain("bob:pw@h");
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

describe("connection registry read-only", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("toInput carries readOnly through save", async () => {
    save.mockResolvedValueOnce([saved()]);
    const r = createConnectionRegistry();
    r.label = "L"; r.host = "localhost";
    r.readOnly = true;
    await r.save();
    const input = (save as any).mock.calls[0][1];
    expect(input.readOnly).toBe(true);
  });

  it("defaults readOnly false after clearForm", async () => {
    save.mockResolvedValueOnce([saved()]);
    const r = createConnectionRegistry();
    r.label = "L"; r.host = "localhost";
    r.readOnly = true;
    await r.save(); // clearForm runs on success
    expect(r.readOnly).toBe(false);
  });
});
