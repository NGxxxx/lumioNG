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
      sshUser: "", sshAuthMethod: "password", sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "", proxyType: "none", proxyHost: "", proxyPort: null, proxyUser: "", proxyPasswordEnc: "", awsSessionTokenEnc: "", gssapiServiceName: "", gssapiServiceRealm: "", gssapiCanonicalize: "", oidcMode: "", oidcEnvironment: "", oidcTokenResource: "",
      environment: "prod", color: "#ff0000", mcpAccess: "read",
    });
    expect(r.connectRequest()).toEqual({
      connId: 7, label: "Prod", uri: "mongodb://db.example:27017/", readOnly: true, ssh: null, environment: "prod", color: "#ff0000",
      mcpAccess: "read", proxy: null,
    });
  });

  it("prod_cannot_be_set_to_write: choosing PROD drops write and the select cannot set it again", () => {
    const r = createConnectionRegistry();
    r.environment = "staging";
    r.mcpAccess = "write";
    expect(r.mcpAccess).toBe("write");
    expect(r.connectRequest()?.mcpAccess).toBe("write");
    r.environment = "prod";
    expect(r.mcpAccess).toBe("read");
    r.mcpAccess = "write";
    expect(r.mcpAccess).toBe("read");
    r.mcpAccess = "off";
    expect(r.connectRequest()?.mcpAccess).toBe("off");
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

describe("connections store — proxy, AWS and Kerberos", () => {
  let r: ReturnType<typeof createConnectionRegistry>;
  beforeEach(() => { r = createConnectionRegistry(); vi.clearAllMocks(); r.label = "L"; r.host = "db.internal"; });

  it("SOCKS5 goes into the URI; the backend gets no separate proxy", () => {
    r.proxyType = "socks5"; r.proxyHost = "px"; r.proxyPort = 1080; r.proxyUser = "u"; r.proxyPassword = "pw";
    const req = r.connectRequest()!;
    expect(req.uri).toContain("proxyHost=px&proxyPort=1080&proxyUsername=u&proxyPassword=pw");
    expect(req.proxy).toBeNull();
  });

  it("HTTP is passed to the backend, keeps the URI free of proxy options and forces a single direct host", () => {
    r.scheme = "mongodb+srv"; r.replicaSet = "rs0";
    r.proxyType = "http"; r.proxyHost = "px"; r.proxyPort = 3128; r.proxyUser = "u"; r.proxyPassword = "pw";
    expect(r.connectRequest()).toBeNull(); // SRV is refused
    r.scheme = "mongodb";
    const req = r.connectRequest()!;
    expect(req.proxy).toEqual({ kind: "http", host: "px", port: 3128, user: "u", password: "pw" });
    expect(req.uri).not.toContain("proxy");
    expect(req.uri).not.toContain("replicaSet");
  });

  it("refuses SSH together with a proxy", () => {
    r.sshEnabled = true; r.sshHost = "b"; r.sshUser = "u"; r.sshPassword = "x";
    r.proxyType = "socks5"; r.proxyHost = "px"; r.proxyPort = 1080;
    expect(r.connectRequest()).toBeNull();
    expect(r.error).toMatch(/SSH/);
  });

  it("toInput obfuscates the proxy password and AWS token, and drops them for other modes", () => {
    r.proxyType = "socks5"; r.proxyHost = "px"; r.proxyPort = 1080; r.proxyPassword = "pw";
    r.authMethod = "aws"; r.user = "AKIA"; r.password = "sec"; r.awsSessionToken = "tok";
    let input = r.toInput();
    expect(input.proxyPasswordEnc).not.toBe(""); expect(input.proxyPasswordEnc).not.toBe("pw");
    expect(input.awsSessionTokenEnc).not.toBe(""); expect(input.awsSessionTokenEnc).not.toBe("tok");
    expect(input.passwordEnc).not.toBe("");
    r.authMethod = "none"; r.proxyType = "none";
    input = r.toInput();
    expect(input.proxyPasswordEnc).toBe(""); expect(input.awsSessionTokenEnc).toBe("");
  });

  it("builds the AWS URI and the Kerberos URI from the form, and edit() restores the secrets", () => {
    r.authMethod = "aws"; r.user = "AKIA"; r.password = "sec"; r.awsSessionToken = "tok";
    expect(r.currentUri()).toContain("authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:tok");
    r.authMethod = "kerberos"; r.user = "bob@EX.COM"; r.gssapiServiceName = "mongodb";
    expect(r.currentUri()).toContain("authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:mongodb");
    r.authMethod = "aws";
    const saved = { ...r.toInput(), id: 5 };
    const r2 = createConnectionRegistry();
    r2.edit(saved);
    expect(r2.awsSessionToken).toBe("tok");
    expect(r2.password).toBe("sec");
  });
});

describe("connections store — AWS credential pairing", () => {
  let r: ReturnType<typeof createConnectionRegistry>;
  beforeEach(() => { r = createConnectionRegistry(); vi.clearAllMocks(); r.label = "L"; r.host = "h"; r.authMethod = "aws"; });

  it("rejects_aws_secret_without_key_id (connect and save)", async () => {
    r.password = "sec";
    expect(r.connectRequest()).toBeNull();
    expect(r.error).toMatch(/access key ID/);
    r.awsSessionToken = "tok"; r.password = "";
    expect(r.connectRequest()).toBeNull();
    await r.save();
    expect(r.formError).toMatch(/access key ID/);
  });

  it("rejects_aws_key_id_without_secret (connect and save)", async () => {
    r.user = "AKIA";
    expect(r.connectRequest()).toBeNull();
    await r.save();
    expect(r.formError).toMatch(/secret access key/);
  });

  it("allows empty credentials and a full pair", () => {
    expect(r.connectRequest()).not.toBeNull();
    r.user = "AKIA"; r.password = "sec";
    expect(r.connectRequest()).not.toBeNull();
  });
});

describe("connections store — OIDC", () => {
  let r: ReturnType<typeof createConnectionRegistry>;
  beforeEach(() => { r = createConnectionRegistry(); vi.clearAllMocks(); r.label = "L"; r.host = "db.internal"; r.authMethod = "oidc"; });

  it("defaults to workforce: a URI without an environment, the user name only as a hint", () => {
    expect(r.oidcMode).toBe("workforce");
    r.user = "me@corp.com";
    expect(r.currentUri()).toBe("mongodb://me%40corp.com@db.internal:27017/?authSource=%24external&authMechanism=MONGODB-OIDC");
    const input = r.toInput();
    expect(input).toMatchObject({ authMethod: "oidc", oidcMode: "workforce", oidcEnvironment: "", oidcTokenResource: "", passwordEnc: "" });
  });

  it("workload builds ENVIRONMENT and TOKEN_RESOURCE, and edit() restores them", () => {
    r.oidcMode = "workload"; r.oidcEnvironment = "gcp"; r.oidcTokenResource = "aud-1";
    expect(r.currentUri()).toContain("authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:gcp,TOKEN_RESOURCE:aud-1");
    const saved = { ...r.toInput(), id: 9 };
    expect(saved).toMatchObject({ oidcMode: "workload", oidcEnvironment: "gcp", oidcTokenResource: "aud-1" });
    const r2 = createConnectionRegistry();
    r2.edit(saved);
    expect([r2.authMethod, r2.oidcMode, r2.oidcEnvironment, r2.oidcTokenResource]).toEqual(["oidc", "workload", "gcp", "aud-1"]);
    expect(r2.uriOf(saved, false)).toContain("ENVIRONMENT:gcp,TOKEN_RESOURCE:aud-1");
  });

  it("a workload without its resource is refused before connecting", () => {
    r.oidcMode = "workload"; r.oidcEnvironment = "azure"; r.oidcTokenResource = "";
    expect(r.connectRequest()).toBeNull();
    expect(r.error).toMatch(/resource/i);
    r.oidcEnvironment = "k8s";
    expect(r.connectRequest()).not.toBeNull();
  });

  it("the OIDC fields are dropped for other methods", () => {
    r.oidcMode = "workload"; r.oidcEnvironment = "gcp"; r.oidcTokenResource = "x";
    r.authMethod = "none";
    expect(r.toInput()).toMatchObject({ oidcMode: "", oidcEnvironment: "", oidcTokenResource: "" });
  });

  it("a pasted OIDC URI fills the form", () => {
    expect(r.fillFromUri("mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api%3A%2F%2Fx").ok).toBe(true);
    expect([r.authMethod, r.oidcMode, r.oidcEnvironment, r.oidcTokenResource]).toEqual(["oidc", "workload", "azure", "api://x"]);
  });

  it("testing a saved connection passes its id (the OIDC refresh-token key)", async () => {
    r.edit({ ...r.toInput(), id: 4 });
    await r.testConnection();
    expect(vi.mocked(apiTestConnection).mock.calls[0][3]).toBe(4);
  });
});
