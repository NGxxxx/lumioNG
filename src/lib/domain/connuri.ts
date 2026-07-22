/** Bidirectional codec between a structured connection profile and a Mongo connection URI.
 *  Pure; no network. The round-trip parseUri(buildProfileUri(p)) === p is the contract. */
export type ConnectionProfile = {
  scheme: "mongodb" | "mongodb+srv";
  host: string;
  port: number | null;
  authMethod: "none" | "password" | "x509" | "ldap";
  user: string;
  authSource: string;
  replicaSet: string;
  tls: boolean;
  extraOptions: string; // raw query fragment, no leading "?"/"&"
  tlsCertificateKeyFile: string; // path; x509 only
};

function hostHasPort(host: string): boolean {
  return host.includes(",") || /:[0-9]+$/.test(host);
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function buildProfileUri(p: ConnectionProfile, password: string, certKeyPassword = ""): string {
  const isLdap = p.authMethod === "ldap";
  const isX509 = p.authMethod === "x509";
  const authSource = isLdap ? "$external" : p.authSource;
  const forcedTls = p.tls || isLdap || isX509;

  let uri = p.scheme + "://";
  if ((p.authMethod === "password" || isLdap) && p.user !== "") {
    uri += encodeURIComponent(p.user);
    if (password !== "") uri += ":" + encodeURIComponent(password);
    uri += "@";
  }
  uri += p.host;
  if (p.scheme === "mongodb" && p.port != null && !hostHasPort(p.host)) {
    uri += ":" + p.port;
  }
  const params: string[] = [];
  if (authSource !== "") params.push("authSource=" + encodeURIComponent(authSource));
  if (p.replicaSet !== "") params.push("replicaSet=" + encodeURIComponent(p.replicaSet));
  if (forcedTls) params.push("tls=true");
  if (isX509) {
    params.push("authMechanism=MONGODB-X509");
    if (p.tlsCertificateKeyFile !== "") {
      params.push("tlsCertificateKeyFile=" + encodeURIComponent(p.tlsCertificateKeyFile));
    }
    if (certKeyPassword !== "") {
      params.push("tlsCertificateKeyFilePassword=" + encodeURIComponent(certKeyPassword));
    }
  } else if (isLdap) {
    params.push("authMechanism=PLAIN");
  }
  const extra = p.extraOptions.trim().replace(/^[?&]+/, "");
  if (extra !== "") params.push(extra);
  uri += "/";
  if (params.length) uri += "?" + params.join("&");
  return uri;
}

export function parseUri(uri: string): { profile: ConnectionProfile; password: string; certKeyPassword: string } {
  const blank: ConnectionProfile = {
    scheme: "mongodb", host: "", port: null, authMethod: "none",
    user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "",
    tlsCertificateKeyFile: "",
  };
  const m = /^(mongodb(?:\+srv)?):\/\/(.*)$/i.exec(uri.trim());
  if (!m) return { profile: blank, password: "", certKeyPassword: "" };

  const scheme: ConnectionProfile["scheme"] =
    m[1].toLowerCase() === "mongodb+srv" ? "mongodb+srv" : "mongodb";
  let rest = m[2];

  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) { query = rest.slice(qIdx + 1); rest = rest.slice(0, qIdx); }
  const slashIdx = rest.indexOf("/");
  if (slashIdx >= 0) rest = rest.slice(0, slashIdx);

  let user = "", password = "";
  let authMethod: ConnectionProfile["authMethod"] = "none";
  const atIdx = rest.lastIndexOf("@");
  if (atIdx >= 0) {
    const userinfo = rest.slice(0, atIdx);
    rest = rest.slice(atIdx + 1);
    const colon = userinfo.indexOf(":");
    if (colon >= 0) {
      user = safeDecode(userinfo.slice(0, colon));
      password = safeDecode(userinfo.slice(colon + 1));
    } else {
      user = safeDecode(userinfo);
    }
    authMethod = "password";
  }

  let host = rest;
  let port: number | null = null;
  if (scheme === "mongodb" && !host.includes(",")) {
    const pm = /^(.*):([0-9]+)$/.exec(host);
    if (pm) { host = pm[1]; port = parseInt(pm[2], 10); }
  }

  let authSource = "", replicaSet = "", tls = false;
  let tlsCertificateKeyFile = "", certKeyPassword = "";
  let authMechanism = "";
  const leftover: string[] = [];
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : "";
    if (k === "authSource") authSource = safeDecode(v);
    else if (k === "replicaSet") replicaSet = safeDecode(v);
    else if (k === "tls") tls = v === "true";
    else if (k === "authMechanism") authMechanism = safeDecode(v);
    else if (k === "tlsCertificateKeyFile") tlsCertificateKeyFile = safeDecode(v);
    else if (k === "tlsCertificateKeyFilePassword") certKeyPassword = safeDecode(v);
    else leftover.push(pair);
  }

  if (authMechanism === "MONGODB-X509") authMethod = "x509";
  else if (authMechanism === "PLAIN") authMethod = "ldap";

  return {
    profile: {
      scheme, host, port, authMethod, user, authSource, replicaSet, tls,
      extraOptions: leftover.join("&"), tlsCertificateKeyFile,
    },
    password,
    certKeyPassword,
  };
}

/** SSH tunnels forward a single fixed host:port, so force a direct single-host shape (no SRV/replicaSet leaking into the built URI). */
export function normalizeForTunnel(p: ConnectionProfile, sshEnabled: boolean): ConnectionProfile {
  if (!sshEnabled) return p;
  return { ...p, scheme: "mongodb", replicaSet: "" };
}
