import { describe, it, expect } from "vitest";
import { awsCredentialProblem, validateProfile, validateProxy, validateSsh, type SshFormFields } from "./connections";
import type { ConnectionProfile } from "./connuri";

const ok: ConnectionProfile = {
  scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none",
  user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "",
  tlsCertificateKeyFile: "",
};

describe("validateProfile", () => {
  it("accepts a valid profile", () => {
    expect(validateProfile("Local", ok)).toEqual({ ok: true });
  });
  it("rejects empty label", () => {
    expect(validateProfile("  ", ok).ok).toBe(false);
  });
  it("rejects empty host", () => {
    expect(validateProfile("L", { ...ok, host: "" }).ok).toBe(false);
  });
  it("rejects out-of-range port", () => {
    expect(validateProfile("L", { ...ok, port: 0 }).ok).toBe(false);
    expect(validateProfile("L", { ...ok, port: 70000 }).ok).toBe(false);
  });
  it("rejects password auth with empty user", () => {
    expect(validateProfile("L", { ...ok, authMethod: "password", user: "" }).ok).toBe(false);
  });
  it("rejects NaN port", () => {
    expect(validateProfile("L", { ...ok, port: NaN }).ok).toBe(false);
  });
});

describe("validateProfile — x509/ldap", () => {
  it("rejects ldap auth with empty user", () => {
    expect(validateProfile("L", { ...ok, authMethod: "ldap", user: "" }).ok).toBe(false);
  });
  it("accepts ldap auth with a user", () => {
    expect(validateProfile("L", { ...ok, authMethod: "ldap", user: "bob" })).toEqual({ ok: true });
  });
  it("rejects x509 auth with no certificate file", () => {
    expect(validateProfile("L", { ...ok, authMethod: "x509", tlsCertificateKeyFile: "" }).ok).toBe(false);
  });
  it("accepts x509 auth with a certificate file", () => {
    expect(validateProfile("L", { ...ok, authMethod: "x509", tlsCertificateKeyFile: "/c.pem" })).toEqual({ ok: true });
  });
});

describe("validateSsh", () => {
  const disabled: SshFormFields = {
    enabled: false, host: "", port: 22, user: "", authMethod: "password", privateKeyPath: "",
  };
  it("accepts a disabled tunnel regardless of other fields", () => {
    expect(validateSsh(disabled)).toEqual({ ok: true });
  });
  it("rejects an enabled tunnel with empty host", () => {
    expect(validateSsh({ ...disabled, enabled: true, user: "u" }).ok).toBe(false);
  });
  it("rejects an enabled tunnel with empty user", () => {
    expect(validateSsh({ ...disabled, enabled: true, host: "bastion" }).ok).toBe(false);
  });
  it("rejects out-of-range ssh port", () => {
    expect(validateSsh({ ...disabled, enabled: true, host: "b", user: "u", port: 0 }).ok).toBe(false);
    expect(validateSsh({ ...disabled, enabled: true, host: "b", user: "u", port: 70000 }).ok).toBe(false);
  });
  it("rejects key auth with no private key path", () => {
    expect(validateSsh({ ...disabled, enabled: true, host: "b", user: "u", authMethod: "key", privateKeyPath: "" }).ok).toBe(false);
  });
  it("accepts key auth with a private key path", () => {
    expect(validateSsh({ ...disabled, enabled: true, host: "b", user: "u", authMethod: "key", privateKeyPath: "/k" })).toEqual({ ok: true });
  });
  it("accepts password auth with an empty password (blank passwords are allowed, mirroring the Mongo password field)", () => {
    expect(validateSsh({ ...disabled, enabled: true, host: "b", user: "u", authMethod: "password" })).toEqual({ ok: true });
  });
});

describe("validateProxy", () => {
  const socks = { ...ok, proxyType: "socks5" as const, proxyHost: "proxy.local", proxyPort: 1080 };
  it("accepts no proxy and a complete SOCKS5 proxy", () => {
    expect(validateProxy(ok, false)).toEqual({ ok: true });
    expect(validateProxy(socks, false)).toEqual({ ok: true });
    expect(validateProfile("L", socks)).toEqual({ ok: true });
  });
  it("rejects_http_proxy_with_srv", () => {
    const http = { ...ok, proxyType: "http" as const, proxyHost: "p", proxyPort: 3128 };
    expect(validateProxy({ ...http, scheme: "mongodb+srv", port: null }, false).ok).toBe(false);
    expect(validateProxy({ ...http, host: "a:1,b:2", port: null }, false).ok).toBe(false);
    expect(validateProxy(http, false)).toEqual({ ok: true });
    // SOCKS5 is applied by the driver to every host, so SRV is fine there.
    expect(validateProxy({ ...socks, scheme: "mongodb+srv", port: null }, false)).toEqual({ ok: true });
  });
  it("rejects_ssh_plus_proxy", () => {
    expect(validateProxy(socks, true).ok).toBe(false);
    expect(validateProxy(ok, true)).toEqual({ ok: true });
  });
  it("requires a proxy host and a valid port", () => {
    expect(validateProxy({ ...socks, proxyHost: " " }, false).ok).toBe(false);
    expect(validateProxy({ ...socks, proxyPort: null }, false).ok).toBe(false);
    expect(validateProxy({ ...socks, proxyPort: 70000 }, false).ok).toBe(false);
  });
});

describe("validateProfile — kerberos", () => {
  it("requires a principal", () => {
    expect(validateProfile("L", { ...ok, authMethod: "kerberos", user: "" }).ok).toBe(false);
    expect(validateProfile("L", { ...ok, authMethod: "kerberos", user: "bob@EXAMPLE.COM" })).toEqual({ ok: true });
  });
});

describe("awsCredentialProblem", () => {
  it("allows all empty (environment credentials) and a complete pair", () => {
    expect(awsCredentialProblem("", "", "")).toBeNull();
    expect(awsCredentialProblem("AKIA", "sec", "")).toBeNull();
    expect(awsCredentialProblem("AKIA", "sec", "tok")).toBeNull();
  });
  it("rejects_aws_secret_without_key_id", () => {
    expect(awsCredentialProblem("", "sec", "")).toBe("needs_key_id");
    expect(awsCredentialProblem(" ", "", "tok")).toBe("needs_key_id");
  });
  it("rejects_aws_key_id_without_secret", () => {
    expect(awsCredentialProblem("AKIA", "", "")).toBe("needs_secret");
    expect(awsCredentialProblem("AKIA", "", "tok")).toBe("needs_secret");
  });
});

describe("validateProfile — oidc", () => {
  const oidc: ConnectionProfile = {
    scheme: "mongodb", host: "h", port: 27017, authMethod: "oidc", user: "", authSource: "", replicaSet: "", tls: false,
    extraOptions: "", tlsCertificateKeyFile: "", oidcMode: "workforce",
  };
  it("workforce needs nothing but a host (the user name is only a hint)", () => {
    expect(validateProfile("x", oidc).ok).toBe(true);
    expect(validateProfile("x", { ...oidc, oidcMode: undefined }).ok).toBe(true);
  });
  it("workload needs a known environment, and a resource for azure and gcp", () => {
    const w = { ...oidc, oidcMode: "workload" as const };
    expect(validateProfile("x", w).ok).toBe(false);
    expect(validateProfile("x", { ...w, oidcEnvironment: "azure" }).ok).toBe(false);
    expect(validateProfile("x", { ...w, oidcEnvironment: "azure", oidcTokenResource: "  " }).ok).toBe(false);
    expect(validateProfile("x", { ...w, oidcEnvironment: "gcp", oidcTokenResource: "aud" }).ok).toBe(true);
    expect(validateProfile("x", { ...w, oidcEnvironment: "k8s" }).ok).toBe(true);
  });
});
