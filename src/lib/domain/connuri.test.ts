import { describe, it, expect } from "vitest";
import { buildProfileUri, parseUri, normalizeForTunnel, suggestLabelFromHost, changedFieldCount, type ConnectionProfile } from "./connuri";

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

describe("suggestLabelFromHost", () => {
  it.each([
    ["db1.example.com", "db1"],
    ["cluster0.ab1cd.mongodb.net", "cluster0"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["db1.example.com:27017", "db1"],
    ["localhost:27017", "localhost"],
    ["10.0.0.5:27018", "10.0.0.5"],
    ["a.example.com:27017,b.example.com:27017", "a"],
    ["mongo", "mongo"],
    ["", ""],
  ])("%s → %s", (host, want) => {
    expect(suggestLabelFromHost(host)).toBe(want);
  });
});

describe("changedFieldCount", () => {
  it("0 for equal profiles", () => {
    expect(changedFieldCount(base, { ...base })).toBe(0);
  });
  it("counts each differing field", () => {
    expect(changedFieldCount(base, { ...base, host: "x", port: null, tls: true })).toBe(3);
    expect(changedFieldCount(base, parseUri("mongodb+srv://u@c.example.net/?replicaSet=rs").profile)).toBeGreaterThan(3);
  });
});

describe("socks5 proxy", () => {
  const socks = { ...base, proxyType: "socks5" as const, proxyHost: "proxy.local", proxyPort: 1080, proxyUser: "pu" };
  it("adds_socks5_params", () => {
    expect(buildProfileUri(socks, "", "", { proxyPassword: "p@w" })).toBe(
      "mongodb://localhost:27017/?proxyHost=proxy.local&proxyPort=1080&proxyUsername=pu&proxyPassword=p%40w",
    );
    expect(buildProfileUri({ ...socks, proxyUser: "" }, "")).toBe("mongodb://localhost:27017/?proxyHost=proxy.local&proxyPort=1080");
  });
  it("never puts an HTTP proxy in the URI", () => {
    expect(buildProfileUri({ ...socks, proxyType: "http" }, "")).toBe("mongodb://localhost:27017/");
  });
  it("parses_socks5_params_back", () => {
    const uri = buildProfileUri(socks, "", "", { proxyPassword: "p@w" });
    const out = parseUri(uri);
    expect(out.profile).toMatchObject({ proxyType: "socks5", proxyHost: "proxy.local", proxyPort: 1080, proxyUser: "pu", extraOptions: "" });
    expect(out.proxyPassword).toBe("p@w");
  });
});

describe("MONGODB-AWS", () => {
  const aws = { ...base, authMethod: "aws" as const, user: "AKIA1" };
  it("builds_aws_uri_with_session_token", () => {
    expect(buildProfileUri(aws, "sec/ret+", "", { awsSessionToken: "tok/en=" })).toBe(
      "mongodb://AKIA1:sec%2Fret%2B@localhost:27017/?authSource=%24external&authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:tok%2Fen%3D",
    );
  });
  it("builds_aws_uri_without_credentials", () => {
    expect(buildProfileUri({ ...aws, user: "" }, "")).toBe(
      "mongodb://localhost:27017/?authSource=%24external&authMechanism=MONGODB-AWS",
    );
  });
  it("parses_mongodb_aws_mechanism", () => {
    const uri = buildProfileUri(aws, "sec/ret+", "", { awsSessionToken: "tok/en=" });
    const out = parseUri(uri);
    expect(out.profile.authMethod).toBe("aws");
    expect(out.profile.user).toBe("AKIA1");
    expect(out.password).toBe("sec/ret+");
    expect(out.awsSessionToken).toBe("tok/en=");
    expect(out.profile.extraOptions).toBe("");
  });
  it("keeps unrelated mechanism properties in extraOptions", () => {
    const out = parseUri("mongodb://h/?authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:t,OTHER:x");
    expect(out.awsSessionToken).toBe("t");
    expect(out.profile.extraOptions).toBe("authMechanismProperties=OTHER:x");
  });
});

describe("GSSAPI (Kerberos)", () => {
  const krb = { ...base, authMethod: "kerberos" as const, user: "bob@EXAMPLE.COM", gssapiServiceName: "mongodb", gssapiServiceRealm: "OTHER.COM", gssapiCanonicalize: "forwardAndReverse" };
  it("builds_gssapi_uri_with_properties", () => {
    expect(buildProfileUri(krb, "ignored")).toBe(
      "mongodb://bob%40EXAMPLE.COM@localhost:27017/?authSource=%24external&authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:mongodb,SERVICE_REALM:OTHER.COM,CANONICALIZE_HOST_NAME:forwardAndReverse",
    );
  });
  it("omits the properties block when none are set", () => {
    expect(buildProfileUri({ ...krb, gssapiServiceName: "", gssapiServiceRealm: "", gssapiCanonicalize: "" }, "")).toBe(
      "mongodb://bob%40EXAMPLE.COM@localhost:27017/?authSource=%24external&authMechanism=GSSAPI",
    );
  });
  it("parses_gssapi_mechanism", () => {
    const out = parseUri(buildProfileUri(krb, ""));
    expect(out.profile).toMatchObject({ authMethod: "kerberos", user: "bob@EXAMPLE.COM", gssapiServiceName: "mongodb", gssapiServiceRealm: "OTHER.COM", gssapiCanonicalize: "forwardAndReverse", extraOptions: "" });
    expect(out.password).toBe("");
  });
});

describe("MONGODB-OIDC", () => {
  const workload = { ...base, authMethod: "oidc" as const, oidcMode: "workload" as const };
  it("builds_oidc_workload_uri", () => {
    expect(buildProfileUri({ ...workload, oidcEnvironment: "azure", oidcTokenResource: "api://my-app/.default", user: "client-1" }, "ignored")).toBe(
      "mongodb://client-1@localhost:27017/?authSource=%24external&authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api%3A%2F%2Fmy-app%2F.default",
    );
    expect(buildProfileUri({ ...workload, oidcEnvironment: "gcp", oidcTokenResource: "https://db.example" }, "")).toBe(
      "mongodb://localhost:27017/?authSource=%24external&authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:gcp,TOKEN_RESOURCE:https%3A%2F%2Fdb.example",
    );
    // k8s has no resource, and only azure takes a user (its managed identity client id).
    expect(buildProfileUri({ ...workload, oidcEnvironment: "k8s", oidcTokenResource: "leftover", user: "x" }, "")).toBe(
      "mongodb://localhost:27017/?authSource=%24external&authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:k8s",
    );
  });
  it("builds the workforce URI with an optional username hint and no environment", () => {
    const wf = { ...base, authMethod: "oidc" as const, oidcMode: "workforce" as const, oidcEnvironment: "azure" as const, oidcTokenResource: "r" };
    expect(buildProfileUri(wf, "")).toBe("mongodb://localhost:27017/?authSource=%24external&authMechanism=MONGODB-OIDC");
    expect(buildProfileUri({ ...wf, user: "me@corp.com" }, "pw")).toBe(
      "mongodb://me%40corp.com@localhost:27017/?authSource=%24external&authMechanism=MONGODB-OIDC",
    );
  });
  it("parses_workload_and_workforce_uris_back", () => {
    const w = parseUri(buildProfileUri({ ...workload, oidcEnvironment: "azure", oidcTokenResource: "api://x", user: "c1" }, ""));
    expect(w.profile).toMatchObject({ authMethod: "oidc", oidcMode: "workload", oidcEnvironment: "azure", oidcTokenResource: "api://x", user: "c1", extraOptions: "" });
    const f = parseUri("mongodb://me%40corp.com@h/?authSource=%24external&authMechanism=MONGODB-OIDC&tls=true");
    expect(f.profile).toMatchObject({ authMethod: "oidc", oidcMode: "workforce", user: "me@corp.com", tls: true });
    expect(f.password).toBe("");
    // Unknown properties are kept rather than dropped.
    expect(parseUri("mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:k8s,ALLOWED_HOSTS:a.b").profile.extraOptions).toBe("authMechanismProperties=ALLOWED_HOSTS:a.b");
  });
});
