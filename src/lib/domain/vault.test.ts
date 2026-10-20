import { describe, it, expect } from "vitest";
import { hasFileSecrets, isWrongPassword, newPasswordProblem, vaultRefusal, withoutSecrets } from "./vault";

describe("hasFileSecrets", () => {
  it("is true only for plain obfuscated secrets kept in the file", () => {
    expect(hasFileSecrets([])).toBe(false);
    expect(hasFileSecrets([{ passwordEnc: "", sshPassphraseEnc: "" }])).toBe(false);
    expect(hasFileSecrets([{ passwordEnc: "abc" }])).toBe(true);
    expect(hasFileSecrets([{ passwordEnc: "abc", secretsInKeychain: true }])).toBe(false);
    expect(hasFileSecrets([{ passwordEnc: "vault:v1:xyz" }])).toBe(false);
  });
  it("covers secret fields added later without a code change", () => {
    expect(hasFileSecrets([{ proxyPasswordEnc: "x" }])).toBe(true);
    expect(hasFileSecrets([{ awsSessionTokenEnc: "x" }])).toBe(true);
    expect(hasFileSecrets([{ label: "Enc-ish", host: "x" }])).toBe(false);
  });
});

describe("isWrongPassword", () => {
  it("recognizes the vault's wrong-password error only", () => {
    expect(isWrongPassword({ kind: "Vault", message: "wrong master password" })).toBe(true);
    expect(isWrongPassword({ kind: "Vault", message: "vault file is corrupted" })).toBe(false);
    expect(isWrongPassword({ kind: "Io", message: "wrong master password" })).toBe(false);
    expect(isWrongPassword("wrong master password")).toBe(false);
    expect(isWrongPassword(null)).toBe(false);
  });
});

describe("newPasswordProblem", () => {
  it("checks empty, length and confirmation in that order", () => {
    expect(newPasswordProblem("", "")).toBe("empty");
    expect(newPasswordProblem("short", "short")).toBe("short");
    // Counted in code points like the backend: 4 astral characters are 4, not 8, UTF-16 units.
    expect(newPasswordProblem("😀😀😀😀", "😀😀😀😀")).toBe("short");
    expect(newPasswordProblem("😀😀😀😀😀😀😀😀", "😀😀😀😀😀😀😀😀")).toBeNull();
    expect(newPasswordProblem("longenough", "different1")).toBe("mismatch");
    expect(newPasswordProblem("longenough", "longenough")).toBeNull();
  });
});

describe("vaultRefusal / withoutSecrets", () => {
  it("recognizes the backend's refusal codes only", () => {
    expect(vaultRefusal({ kind: "Vault", message: "vault_locked" })).toBe("vault_locked");
    expect(vaultRefusal({ kind: "Vault", message: "vault_uninitialized" })).toBe("vault_uninitialized");
    expect(vaultRefusal({ kind: "Vault", message: "wrong master password" })).toBeNull();
    expect(vaultRefusal({ kind: "Io", message: "vault_locked" })).toBeNull();
    expect(vaultRefusal(undefined)).toBeNull();
  });
  it("blanks every Enc field and nothing else", () => {
    expect(withoutSecrets({ label: "a", passwordEnc: "x", proxyPasswordEnc: "y", port: 1 })).toEqual({ label: "a", passwordEnc: "", proxyPasswordEnc: "", port: 1 });
  });
});
