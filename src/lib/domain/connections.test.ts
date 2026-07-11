import { describe, it, expect } from "vitest";
import { validateProfile, validateSsh, type SshFormFields } from "./connections";
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
