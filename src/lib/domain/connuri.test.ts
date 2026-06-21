import { describe, it, expect } from "vitest";
import { buildProfileUri, parseUri, type ConnectionProfile } from "./connuri";

const base: ConnectionProfile = {
  scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none",
  user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "",
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

describe("parseUri round-trip", () => {
  // Round-trip holds only for normalized profiles: password-auth implies non-empty user;
  // none-auth implies empty user; SRV implies port null; extraOptions has no authSource/
  // replicaSet/tls keys and no leading ?/&.
  const cases: { profile: ConnectionProfile; password: string }[] = [
    { profile: { scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none", user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "" }, password: "" },
    { profile: { scheme: "mongodb", host: "db.local", port: 27018, authMethod: "password", user: "bob", authSource: "admin", replicaSet: "", tls: false, extraOptions: "" }, password: "p@ss/word" },
    { profile: { scheme: "mongodb+srv", host: "cluster.example.net", port: null, authMethod: "password", user: "u", authSource: "", replicaSet: "", tls: false, extraOptions: "" }, password: "x" },
    { profile: { scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none", user: "", authSource: "", replicaSet: "rs0", tls: true, extraOptions: "readPreference=secondary&appName=app" }, password: "" },
    { profile: { scheme: "mongodb", host: "h1:1,h2:2", port: null, authMethod: "none", user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "" }, password: "" },
  ];
  for (const [i, c] of cases.entries()) {
    it(`round-trips case ${i}`, () => {
      expect(parseUri(buildProfileUri(c.profile, c.password))).toEqual(c);
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
