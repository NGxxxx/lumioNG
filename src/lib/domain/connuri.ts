/** Bidirectional codec between a structured connection profile and a Mongo connection URI.
 *  Pure; no network. The round-trip parseUri(buildProfileUri(p)) === p is the contract. */
export type ConnectionProfile = {
  scheme: "mongodb" | "mongodb+srv";
  host: string;
  port: number | null;
  authMethod: "none" | "password" | "x509" | "ldap" | "aws" | "kerberos" | "oidc";
  user: string;
  authSource: string;
  replicaSet: string;
  tls: boolean;
  extraOptions: string; // raw query fragment, no leading "?"/"&"
  tlsCertificateKeyFile: string; // path; x509 only
  // Optional so a profile without them (an older caller, a test fixture) stays valid; absent = default.
  /** "socks5" travels in the URI (driver-native); "http" is handled by the app (CONNECT tunnel) and never appears in the URI. */
  proxyType?: ProxyType;
  proxyHost?: string;
  proxyPort?: number | null;
  proxyUser?: string;
  /** Kerberos (GSSAPI) mechanism properties; "" = driver default. */
  gssapiServiceName?: string;
  gssapiServiceRealm?: string;
  gssapiCanonicalize?: string;
  /** MONGODB-OIDC. "workforce" (default when absent): browser sign-in, `user` is only a username hint.
   *  "workload": the machine identity of `oidcEnvironment`, with `oidcTokenResource` as audience. */
  oidcMode?: OidcMode;
  oidcEnvironment?: OidcEnvironment;
  oidcTokenResource?: string;
};

export type OidcMode = "workforce" | "workload";
export type OidcEnvironment = "azure" | "gcp" | "k8s";
export const OIDC_ENVIRONMENTS: readonly OidcEnvironment[] = ["azure", "gcp", "k8s"];

/** Whether the workload environment takes a TOKEN_RESOURCE (k8s reads its own token file). */
export function oidcNeedsResource(env: OidcEnvironment | undefined): boolean {
  return env === "azure" || env === "gcp";
}

export type ProxyType = "none" | "socks5" | "http";

/** Secrets that live in the URI but outside the profile (never stored in the profile object). */
export type UriSecrets = { proxyPassword?: string; awsSessionToken?: string };

function hostHasPort(host: string): boolean {
  return host.includes(",") || /:[0-9]+$/.test(host);
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function buildProfileUri(p: ConnectionProfile, password: string, certKeyPassword = "", secrets: UriSecrets = {}): string {
  const isLdap = p.authMethod === "ldap";
  const isX509 = p.authMethod === "x509";
  const isAws = p.authMethod === "aws";
  const isKerberos = p.authMethod === "kerberos";
  const isOidc = p.authMethod === "oidc";
  const oidcWorkload = isOidc && p.oidcMode === "workload";
  // Workforce: the user name is a sign-in hint. Workload: only Azure takes one (the managed identity's client id).
  const oidcUser = isOidc && (!oidcWorkload || p.oidcEnvironment === "azure");
  const authSource = isLdap || isAws || isKerberos || isOidc ? "$external" : p.authSource;
  const forcedTls = p.tls || isLdap || isX509;

  let uri = p.scheme + "://";
  if ((p.authMethod === "password" || isLdap || isAws || isKerberos || oidcUser) && p.user !== "") {
    uri += encodeURIComponent(p.user);
    if (password !== "" && !isKerberos && !isOidc) uri += ":" + encodeURIComponent(password);
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
  } else if (isAws) {
    params.push("authMechanism=MONGODB-AWS");
    // Empty credentials: the driver falls back to the environment / instance profile / ECS / EKS.
    const token = secrets.awsSessionToken ?? "";
    if (token !== "") params.push("authMechanismProperties=AWS_SESSION_TOKEN:" + encodeURIComponent(token));
  } else if (isOidc) {
    params.push("authMechanism=MONGODB-OIDC");
    if (oidcWorkload && p.oidcEnvironment) {
      const props = ["ENVIRONMENT:" + p.oidcEnvironment];
      const resource = (p.oidcTokenResource ?? "").trim();
      if (oidcNeedsResource(p.oidcEnvironment) && resource !== "") props.push("TOKEN_RESOURCE:" + encodeURIComponent(resource));
      params.push("authMechanismProperties=" + props.join(","));
    }
  } else if (isKerberos) {
    params.push("authMechanism=GSSAPI");
    const props: string[] = [];
    if ((p.gssapiServiceName ?? "") !== "") props.push("SERVICE_NAME:" + encodeURIComponent(p.gssapiServiceName!));
    if ((p.gssapiServiceRealm ?? "") !== "") props.push("SERVICE_REALM:" + encodeURIComponent(p.gssapiServiceRealm!));
    if ((p.gssapiCanonicalize ?? "") !== "") props.push("CANONICALIZE_HOST_NAME:" + encodeURIComponent(p.gssapiCanonicalize!));
    if (props.length) params.push("authMechanismProperties=" + props.join(","));
  }
  if (p.proxyType === "socks5" && (p.proxyHost ?? "") !== "") {
    params.push("proxyHost=" + encodeURIComponent(p.proxyHost!));
    if (p.proxyPort != null) params.push("proxyPort=" + p.proxyPort);
    if ((p.proxyUser ?? "") !== "") params.push("proxyUsername=" + encodeURIComponent(p.proxyUser!));
    if ((secrets.proxyPassword ?? "") !== "") params.push("proxyPassword=" + encodeURIComponent(secrets.proxyPassword!));
  }
  const extra = p.extraOptions.trim().replace(/^[?&]+/, "");
  if (extra !== "") params.push(extra);
  uri += "/";
  if (params.length) uri += "?" + params.join("&");
  return uri;
}

export function parseUri(uri: string): { profile: ConnectionProfile; password: string; certKeyPassword: string } & UriSecrets {
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
  let mechProps = "";
  let proxyHost = "", proxyUser = "", proxyPassword = "";
  let proxyPort: number | null = null;
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
    else if (k === "authMechanismProperties") mechProps = v;
    else if (k === "proxyHost") proxyHost = safeDecode(v);
    else if (k === "proxyPort") { const n = parseInt(v, 10); proxyPort = Number.isNaN(n) ? null : n; }
    else if (k === "proxyUsername") proxyUser = safeDecode(v);
    else if (k === "proxyPassword") proxyPassword = safeDecode(v);
    else leftover.push(pair);
  }

  if (authMechanism === "MONGODB-X509") authMethod = "x509";
  else if (authMechanism === "PLAIN") authMethod = "ldap";
  else if (authMechanism === "MONGODB-AWS") authMethod = "aws";
  else if (authMechanism === "GSSAPI") authMethod = "kerberos";
  else if (authMechanism === "MONGODB-OIDC") authMethod = "oidc";

  // Mechanism properties: the ones this app edits become fields, any others stay in extraOptions.
  let awsSessionToken = "", gssapiServiceName = "", gssapiServiceRealm = "", gssapiCanonicalize = "";
  let oidcEnvironment = "", oidcTokenResource = "";
  if (mechProps !== "") {
    const rest: string[] = [];
    for (const prop of mechProps.split(",")) {
      const c = prop.indexOf(":");
      const name = c >= 0 ? prop.slice(0, c) : prop;
      const val = c >= 0 ? safeDecode(prop.slice(c + 1)) : "";
      if (authMethod === "aws" && name === "AWS_SESSION_TOKEN") awsSessionToken = val;
      else if (authMethod === "kerberos" && name === "SERVICE_NAME") gssapiServiceName = val;
      else if (authMethod === "kerberos" && name === "SERVICE_REALM") gssapiServiceRealm = val;
      else if (authMethod === "kerberos" && name === "CANONICALIZE_HOST_NAME") gssapiCanonicalize = val;
      else if (authMethod === "oidc" && name === "ENVIRONMENT" && (OIDC_ENVIRONMENTS as readonly string[]).includes(val)) oidcEnvironment = val;
      else if (authMethod === "oidc" && name === "TOKEN_RESOURCE") oidcTokenResource = val;
      else rest.push(prop);
    }
    if (rest.length) leftover.push("authMechanismProperties=" + rest.join(","));
  }
  // Kerberos never takes a password from the form; aws keeps userinfo as key id + secret.
  if (authMethod === "kerberos" || authMethod === "oidc") password = "";

  const profile: ConnectionProfile = {
    scheme, host, port, authMethod, user, authSource, replicaSet, tls,
    extraOptions: leftover.join("&"), tlsCertificateKeyFile,
  };
  if (proxyHost !== "") {
    profile.proxyType = "socks5";
    profile.proxyHost = proxyHost;
    profile.proxyPort = proxyPort;
    if (proxyUser !== "") profile.proxyUser = proxyUser;
  }
  if (gssapiServiceName !== "") profile.gssapiServiceName = gssapiServiceName;
  if (gssapiServiceRealm !== "") profile.gssapiServiceRealm = gssapiServiceRealm;
  if (gssapiCanonicalize !== "") profile.gssapiCanonicalize = gssapiCanonicalize;
  if (authMethod === "oidc") {
    profile.oidcMode = oidcEnvironment !== "" ? "workload" : "workforce";
    if (oidcEnvironment !== "") profile.oidcEnvironment = oidcEnvironment as OidcEnvironment;
    if (oidcTokenResource !== "") profile.oidcTokenResource = oidcTokenResource;
  }
  return {
    profile,
    password,
    certKeyPassword,
    ...(proxyPassword !== "" ? { proxyPassword } : {}),
    ...(awsSessionToken !== "" ? { awsSessionToken } : {}),
  };
}

/** SSH and HTTP-proxy tunnels forward a single fixed host:port, so force a direct single-host shape (no SRV/replicaSet leaking into the built URI). */
export function normalizeForTunnel(p: ConnectionProfile, tunneled: boolean): ConnectionProfile {
  if (!tunneled) return p;
  return { ...p, scheme: "mongodb", replicaSet: "" };
}

/** Default connection name from a host: first dotted label (so an Atlas SRV cluster name shows as "cluster0"); IPs and localhost stay whole; port and extra seeds dropped. */
export function suggestLabelFromHost(host: string): string {
  const first = host.split(",")[0].trim().replace(/:[0-9]+$/, "");
  if (/^[0-9]+(\.[0-9]+){3}$/.test(first)) return first;
  return first.split(".")[0];
}

/** Number of profile fields whose value differs (for "Filled N fields from the URI"). */
export function changedFieldCount(before: ConnectionProfile, after: ConnectionProfile): number {
  let n = 0;
  for (const k of Object.keys(after) as (keyof ConnectionProfile)[]) {
    if (before[k] !== after[k]) n++;
  }
  return n;
}
