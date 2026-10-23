import { describe, it, expect } from "vitest";
import { ciphertextPaths, plaintextRequiredPaths, decryptReasonKey, isEncryptedBinary, isValidNamespace, buildKmsInput, emptyKmsForm, settingsProblem, buildConfig, masterKeyJson, keyLabel, DEFAULT_KEY_VAULT_NAMESPACE } from "./csfle";
import { describeValue } from "./extjson";

describe("isEncryptedBinary", () => {
  it("recognises BinData subtype 6 only", () => {
    expect(isEncryptedBinary({ $binary: { base64: "AAA=", subType: "06" } })).toBe(true);
    expect(isEncryptedBinary({ $binary: { base64: "AAA=", subType: "6" } })).toBe(true);
    expect(isEncryptedBinary({ $binary: { base64: "AAA=", subType: "00" } })).toBe(false);
    expect(isEncryptedBinary({ $binary: { base64: "AAA=", subType: "04" } })).toBe(false);
    expect(isEncryptedBinary("06")).toBe(false);
    expect(isEncryptedBinary(null)).toBe(false);
    expect(isEncryptedBinary([{ $binary: { subType: "06" } }])).toBe(false);
  });
  it("makes the grid label an encrypted value as such", () => {
    const info = describeValue({ $binary: { base64: "AAAAAAAA", subType: "06" } });
    expect(info.type).toBe("binary");
    expect(info.display).toContain("Encrypted");
    expect(describeValue({ $binary: { base64: "AAAA", subType: "00" } }).display).toContain("Binary");
  });
});

describe("namespace", () => {
  it("needs database.collection", () => {
    expect(isValidNamespace("encryption.__keyVault")).toBe(true);
    expect(isValidNamespace("a.b.c")).toBe(true);
    for (const bad of ["", "nodot", ".c", "d.", "a b.c", "$d.c"]) expect(isValidNamespace(bad)).toBe(false);
  });
});

describe("buildKmsInput", () => {
  it("sends only what was typed for the providers that are on", () => {
    const f = { ...emptyKmsForm(), awsAccessKeyId: " AK ", awsSecretAccessKey: "sec", azureTenantId: "t", azureClientId: "c", azureClientSecret: "s" };
    const out = buildKmsInput(f, ["aws"]);
    expect(out).toEqual({ aws: { accessKeyId: "AK", secretAccessKey: "sec", sessionToken: "" } });
    expect(buildKmsInput(emptyKmsForm(), ["aws", "local", "gcp"])).toEqual({});
  });
  it("covers local, gcp and kmip", () => {
    const f = { ...emptyKmsForm(), localKeyFile: " /k.key ", gcpEmail: "sa@x", gcpPrivateKey: "KEY", kmipEndpoint: "h:5696", kmipCertPassword: "pw" };
    const out = buildKmsInput(f, ["local", "gcp", "kmip"]);
    expect(out.localKeyFile).toBe("/k.key");
    expect(out.gcp).toEqual({ email: "sa@x", privateKey: "KEY" });
    expect(out.kmip).toEqual({ endpoint: "h:5696", caFile: "", clientCertFile: "", certPassword: "pw" });
  });
});

describe("settingsProblem", () => {
  it("flags a bad namespace, no providers, and missing credentials", () => {
    expect(settingsProblem(true, "bad", ["aws"], [], {})).toBe("namespace");
    expect(settingsProblem(true, "a.b", [], [], {})).toBe("providers");
    expect(settingsProblem(true, "a.b", ["aws"], [], {})).toBe("credentials");
    expect(settingsProblem(true, "a.b", ["aws"], ["aws"], {})).toBeNull();
    expect(settingsProblem(true, "a.b", ["local"], [], { localKeyFile: "/k" })).toBeNull();
    expect(settingsProblem(false, "a.b", [], [], {})).toBeNull();
  });
});

describe("buildConfig / masterKeyJson / keyLabel", () => {
  it("defaults the namespace and trims", () => {
    expect(buildConfig(true, " ", ["local"], " /lib ").keyVaultNamespace).toBe(DEFAULT_KEY_VAULT_NAMESPACE);
    expect(buildConfig(true, "a.b", ["local"], " /lib ").cryptSharedLibPath).toBe("/lib");
  });
  it("builds master key descriptions per provider and drops blanks", () => {
    expect(masterKeyJson("local", {})).toBeNull();
    expect(masterKeyJson("nope", {})).toBeNull();
    expect(JSON.parse(masterKeyJson("kmip", { keyId: " 1 ", endpoint: "" })!)).toEqual({ keyId: "1" });
    expect(JSON.parse(masterKeyJson("aws", { region: "us-east-1", key: "arn:aws:kms:x", endpoint: "" })!)).toEqual({ region: "us-east-1", key: "arn:aws:kms:x" });
    expect(JSON.parse(masterKeyJson("gcp", { projectId: "p", location: "global", keyRing: "r", keyName: "k" })!)).toEqual({ projectId: "p", location: "global", keyRing: "r", keyName: "k" });
  });
  it("labels keys by alternate name", () => {
    expect(keyLabel({ id: "AAAAAAAAAAAAAAAAAAAAAA==", keyAltNames: ["pii"], provider: "local" })).toBe("pii (local)");
    expect(keyLabel({ id: "AAAAAAAAAAAAAAAAAAAAAA==", keyAltNames: [], provider: "" })).toBe("AAAAAAAA…");
  });
});

describe("plaintextRequiredPaths", () => {
  it("reads the paths out of the backend error", () => {
    expect(plaintextRequiredPaths("Query: csfle_plaintext_required:ssn,a.b")).toEqual(["ssn", "a.b"]);
    expect(plaintextRequiredPaths("Query: Connection is read-only")).toBeNull();
  });
});

describe("decryptReasonKey", () => {
  it("maps libmongocrypt text to a localized reason", () => {
    expect(decryptReasonKey("Encryption: key not found in key vault")).toBe("csfle_decrypt_key_missing");
    expect(decryptReasonKey("Encryption: KMS request failed: access denied")).toBe("csfle_decrypt_kms");
    expect(decryptReasonKey("Encryption: connection timed out")).toBe("csfle_decrypt_kms");
    expect(decryptReasonKey("Encryption: something odd")).toBe("csfle_decrypt_generic");
  });
});

describe("ciphertextPaths", () => {
  const c = { $binary: { base64: "AQID", subType: "06" } };
  it("lists dotted paths, array elements by index, and skips plain binary", () => {
    expect(ciphertextPaths({ a: 1, ssn: c, n: { x: c, y: "p" }, l: ["p", c], bin: { $binary: { base64: "AA==", subType: "00" } } })).toEqual(["ssn", "n.x", "l.1"]);
    expect(ciphertextPaths({})).toEqual([]);
  });
});
