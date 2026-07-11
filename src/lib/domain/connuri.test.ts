import { describe, it, expect } from "vitest";
import { buildProfileUri, parseUri, normalizeForTunnel, type ConnectionProfile } from "./connuri";

const base: ConnectionProfile = {
  scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none",
  user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "",
  tlsCertificateKeyFile: "",
};

describe("buildProfileUri", () => {
  it("direct no-auth", () => {
    expect(buildProfileUri(base, "")).toBe("mongodb://localhost:27017/");
  });
  it("direct with auth + authSource", () => {
    const p = { ...base, authMethod: "password" as const, user: "bob", authSource: "admin" };
    expect(buildProfileUri(p, "p@ss")).toBe("mongodb://bob:p%40ss@localhost:27017/?authSource=admin");
  });
  it("srv omits port", () => {
    const p = { ...base, scheme: "mongodb+srv" as const, host: "cluster.example.net", port: null };
    expect(buildProfileUri(p, "")).toBe("mongodb+srv://cluster.example.net/");
  });
  it("replicaSet + tls + extraOptions in order", () => {
    const p = { ...base, replicaSet: "rs0", tls: true, extraOptions: "appName=x" };
    expect(buildProfileUri(p, "")).toBe("mongodb://localhost:27017/?replicaSet=rs0&tls=true&appName=x");
  });
  it("host already carrying a port suppresses the port field", () => {
    const p = { ...base, host: "h1:1,h2:2", port: 27017 };
    expect(buildProfileUri(p, "")).toBe("mongodb://h1:1,h2:2/");
  });
});

describe("buildProfileUri — x509", () => {
  it("omits userinfo, forces tls, sets authMechanism and cert file", () => {
    const p = { ...base, authMethod: "x509" as const, tlsCertificateKeyFile: "/certs/client.pem" };
    expect(buildProfileUri(p, "")).toBe(
      "mongodb://localhost:27017/?tls=true&authMechanism=MONGODB-X509&tlsCertificateKeyFile=%2Fcerts%2Fclient.pem",
    );
  });
  it("includes an encrypted cert key file password when given", () => {
    const p = { ...base, authMethod: "x509" as const, tlsCertificateKeyFile: "/c.pem" };
    expect(buildProfileUri(p, "", "certpw")).toBe(
      "mongodb://localhost:27017/?tls=true&authMechanism=MONGODB-X509&tlsCertificateKeyFile=%2Fc.pem&tlsCertificateKeyFilePassword=certpw",
    );
  });
  it("round-trips a cert key password containing reserved characters", () => {
    const p = { ...base, authMethod: "x509" as const, tlsCertificateKeyFile: "/c.pem" };
    const uri = buildProfileUri(p, "", "p@ss&word");
    const { certKeyPassword } = parseUri(uri);
    expect(certKeyPassword).toBe("p@ss&word");
  });
});

describe("buildProfileUri — ldap", () => {
  it("keeps userinfo, forces tls and authSource=$external, sets authMechanism=PLAIN", () => {
    const p = { ...base, authMethod: "ldap" as const, user: "bob", authSource: "admin" };
    expect(buildProfileUri(p, "s3cret")).toBe(
      "mongodb://bob:s3cret@localhost:27017/?authSource=%24external&tls=true&authMechanism=PLAIN",
    );
  });
});

describe("parseUri — x509/ldap", () => {
  it("round-trips x509", () => {
    const uri = "mongodb://localhost:27017/?tls=true&authMechanism=MONGODB-X509&tlsCertificateKeyFile=%2Fcerts%2Fclient.pem&tlsCertificateKeyFilePassword=certpw";
    const { profile, password, certKeyPassword } = parseUri(uri);
    expect(profile.authMethod).toBe("x509");
    expect(profile.tlsCertificateKeyFile).toBe("/certs/client.pem");
    expect(profile.tls).toBe(true);
    expect(password).toBe("");
    expect(certKeyPassword).toBe("certpw");
  });
  it("round-trips ldap", () => {
    const uri = "mongodb://bob:s3cret@localhost:27017/?authSource=%24external&tls=true&authMechanism=PLAIN";
    const { profile, password } = parseUri(uri);
    expect(profile.authMethod).toBe("ldap");
    expect(profile.user).toBe("bob");
    expect(password).toBe("s3cret");
    expect(profile.authSource).toBe("$external");
  });
});

describe("normalizeForTunnel", () => {
  it("passes through unchanged when ssh is disabled", () => {
    const p = { ...base, scheme: "mongodb+srv" as const, replicaSet: "rs0", port: null };
    expect(normalizeForTunnel(p, false)).toEqual(p);
  });
  it("forces mongodb scheme and drops replicaSet when ssh is enabled", () => {
    const p = { ...base, scheme: "mongodb+srv" as const, replicaSet: "rs0", port: null };
    const out = normalizeForTunnel(p, true);
    expect(out.scheme).toBe("mongodb");
    expect(out.replicaSet).toBe("");
  });
});

describe("parseUri round-trip", () => {
  // Round-trip holds only for normalized profiles: password-auth implies non-empty user;
  // none-auth implies empty user; SRV implies port null; extraOptions has no authSource/
  // replicaSet/tls keys and no leading ?/&.
  const cases: { profile: ConnectionProfile; password: string }[] = [
    { profile: { scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none", user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", tlsCertificateKeyFile: "" }, password: "" },
    { profile: { scheme: "mongodb", host: "db.local", port: 27018, authMethod: "password", user: "bob", authSource: "admin", replicaSet: "", tls: false, extraOptions: "", tlsCertificateKeyFile: "" }, password: "p@ss/word" },
    { profile: { scheme: "mongodb+srv", host: "cluster.example.net", port: null, authMethod: "password", user: "u", authSource: "", replicaSet: "", tls: false, extraOptions: "", tlsCertificateKeyFile: "" }, password: "x" },
    { profile: { scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none", user: "", authSource: "", replicaSet: "rs0", tls: true, extraOptions: "readPreference=secondary&appName=app", tlsCertificateKeyFile: "" }, password: "" },
    { profile: { scheme: "mongodb", host: "h1:1,h2:2", port: null, authMethod: "none", user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", tlsCertificateKeyFile: "" }, password: "" },
  ];
  for (const [i, c] of cases.entries()) {
    it(`round-trips case ${i}`, () => {
      expect(parseUri(buildProfileUri(c.profile, c.password))).toEqual({ ...c, certKeyPassword: "" });
    });
  }

  it("recognized keys go to fields, the rest to extraOptions", () => {
    const { profile } = parseUri("mongodb://localhost:27017/?tls=true&appName=x&foo=bar");
    expect(profile.tls).toBe(true);
    expect(profile.extraOptions).toBe("appName=x&foo=bar");
  });

  it("malformed URI is best-effort, never throws", () => {
    const { profile, password } = parseUri("not a uri");
    expect(profile.host).toBe("");
    expect(password).toBe("");
  });

  it("does not throw on a malformed percent-escape", () => {
    expect(() => parseUri("mongodb://%ZZ@host:27017/")).not.toThrow();
    const { profile } = parseUri("mongodb://%ZZ@host:27017/");
    expect(profile.host).toBe("host");
  });
});
