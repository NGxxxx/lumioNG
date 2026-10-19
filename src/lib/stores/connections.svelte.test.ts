import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "keychain"),
  listConnections: vi.fn().mockResolvedValue([]),
  saveConnection: vi.fn().mockResolvedValue([]),
  deleteConnection: vi.fn().mockResolvedValue([]),
  touchConnection: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/connection", () => ({
  testConnection: vi.fn().mockResolvedValue(undefined),
}));
import { createConnectionRegistry } from "./connections.svelte";
import { testConnection as apiTestConnection } from "../api/connection";

describe("connections store — SSH fields", () => {
  let r: ReturnType<typeof createConnectionRegistry>;
  beforeEach(() => { r = createConnectionRegistry(); vi.clearAllMocks(); });

  it("defaults sshEnabled to false and sshPort to 22", () => {
    expect(r.sshEnabled).toBe(false);
    expect(r.sshPort).toBe(22);
  });

  it("toInput does not persist a cert-key passphrase left over from a since-abandoned x509 selection", () => {
    r.label = "L"; r.host = "h";
    r.authMethod = "x509"; r.tlsCertificateKeyFilePassword = "leftover-secret";
    r.authMethod = "none"; // user switched away from x509 without clearing the passphrase field
    const input = r.toInput();
    expect(input.tlsCertificateKeyFilePasswordEnc).toBe("");
  });

  it("toInput obfuscates the cert-key passphrase when x509 is actually selected", () => {
    r.label = "L"; r.host = "h";
    r.authMethod = "x509"; r.tlsCertificateKeyFile = "/c.pem"; r.tlsCertificateKeyFilePassword = "secret";
    const input = r.toInput();
    expect(input.tlsCertificateKeyFilePasswordEnc).not.toBe("");
    expect(input.tlsCertificateKeyFilePasswordEnc).not.toBe("secret");
  });

  it("toInput carries ssh fields with obfuscated secrets", () => {
    r.label = "L"; r.host = "h";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy";
    r.sshAuthMethod = "password"; r.sshPassword = "secret";
    const input = r.toInput();
    expect(input.sshEnabled).toBe(true);
    expect(input.sshHost).toBe("bastion");
    expect(input.sshPasswordEnc).not.toBe("");
    expect(input.sshPasswordEnc).not.toBe("secret");
  });

  it("connectTo returns null ssh when the tunnel is disabled", () => {
    r.host = "h";
    const result = r.connectTo();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ssh).toBeNull();
  });

  it("connectTo returns a plaintext ssh payload when the tunnel is enabled", () => {
    r.host = "h";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy";
    r.sshAuthMethod = "password"; r.sshPassword = "secret";
    const result = r.connectTo();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ssh).toEqual({
        enabled: true, host: "bastion", port: 22, user: "deploy",
        authMethod: "password", password: "secret", privateKeyPath: "", passphrase: "",
      });
    }
  });

  it("toInput normalizes scheme/replicaSet away when the tunnel is enabled", () => {
    r.label = "L"; r.host = "h"; r.scheme = "mongodb+srv"; r.replicaSet = "rs0";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy";
    const input = r.toInput();
    expect(input.scheme).toBe("mongodb");
    expect(input.replicaSet).toBe("");
  });

  it("connectTo normalizes scheme/replicaSet away when the tunnel is enabled", () => {
    r.host = "h"; r.scheme = "mongodb+srv"; r.replicaSet = "rs0";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy";
    const result = r.connectTo();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uri.startsWith("mongodb://")).toBe(true);
  });

  it("testConnection resolves ok on success", async () => {
    r.host = "h";
    const result = await r.testConnection();
    expect(result).toEqual({ ok: true });
    expect(apiTestConnection).toHaveBeenCalledOnce();
  });

  it("testConnection maps an SshTunnel error kind to 'ssh'", async () => {
    (apiTestConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ kind: "SshTunnel", message: "auth rejected" });
    r.host = "h";
    const result = await r.testConnection();
    expect(result).toEqual({ ok: false, kind: "ssh", message: "auth rejected" });
  });

  it("testConnection maps a Connection error kind to 'mongo'", async () => {
    (apiTestConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ kind: "Connection", message: "auth failed" });
    r.host = "h";
    const result = await r.testConnection();
    expect(result).toEqual({ ok: false, kind: "mongo", message: "auth failed" });
  });

  it("connectTo rejects an out-of-range ssh port before building a URI", () => {
    r.host = "h";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy"; r.sshPort = 70000;
    const result = r.connectTo();
    expect(result).toEqual({ ok: false });
    expect(r.error).toMatch(/ssh port/i);
  });

  it("connectTo rejects x509 auth with no certificate file", () => {
    r.host = "h"; r.authMethod = "x509"; r.tlsCertificateKeyFile = "";
    const result = r.connectTo();
    expect(result).toEqual({ ok: false });
    expect(r.error).toMatch(/certificate/i);
  });

  it("connectTo still works for an unsaved (ad-hoc) connection with no label", () => {
    r.host = "h";
    const result = r.connectTo();
    expect(result.ok).toBe(true);
  });

  it("testConnection returns a validation-kind result without calling the API when a field is invalid", async () => {
    r.host = "h";
    r.sshEnabled = true; r.sshHost = "bastion"; r.sshUser = "deploy"; r.sshPort = 70000;
    const result = await r.testConnection();
    expect(result).toEqual({ ok: false, kind: "validation", message: expect.stringMatching(/ssh port/i) });
    expect(apiTestConnection).not.toHaveBeenCalled();
  });

  it("testConnection still works for an unsaved (ad-hoc) connection with no label", async () => {
    r.host = "h";
    const result = await r.testConnection();
    expect(result).toEqual({ ok: true });
  });
});

describe("connections store — connectRequest", () => {
  it("builds the full connect request for a saved connection (id, label, env, read-only)", () => {
    const r = createConnectionRegistry();
    r.edit({
      id: 7, label: "Prod", scheme: "mongodb", host: "db.example", port: 27017, authMethod: "none", user: "",
      passwordEnc: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", readOnly: true,
      tlsCertificateKeyFile: "", tlsCertificateKeyFilePasswordEnc: "", sshEnabled: false, sshHost: "", sshPort: 22,
      sshUser: "", sshAuthMethod: "password", sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "",
      environment: "prod", color: "#ff0000",
    });
    expect(r.connectRequest()).toEqual({
      connId: 7, label: "Prod", uri: "mongodb://db.example:27017/", readOnly: true, ssh: null, environment: "prod", color: "#ff0000",
    });
  });

  it("an ad-hoc connection has no id and is labelled by its URI", () => {
    const r = createConnectionRegistry();
    r.host = "localhost";
    const req = r.connectRequest();
    expect(req?.connId).toBeNull();
    expect(req?.label).toBe(req?.uri);
  });

  it("is null (with the validation error set) when the form is invalid", () => {
    const r = createConnectionRegistry();
    r.host = "";
    expect(r.connectRequest()).toBeNull();
    expect(r.error).not.toBeNull();
  });
});
