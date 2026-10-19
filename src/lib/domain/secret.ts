/** Reversible obfuscation (XOR against a fixed key, base64-wrapped). HeidiSQL-style:
 *  defeats casual disk reading, not a determined local attacker. Pure; no network.
 *  Saved passwords normally live in the OS keychain (src-tauri/src/secrets.rs); this layer only
 *  matters where no keychain is available. */
const KEY = new TextEncoder().encode("lumiong-v1-obfuscation-key");

function xor(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KEY[i % KEY.length];
  return out;
}

export function obfuscate(plain: string): string {
  if (plain === "") return "";
  const x = xor(new TextEncoder().encode(plain));
  let bin = "";
  for (const b of x) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function deobfuscate(enc: string): string {
  if (enc === "") return "";
  const bin = atob(enc);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(xor(bytes));
}
