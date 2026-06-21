import { describe, it, expect } from "vitest";
import { obfuscate, deobfuscate } from "./secret";

describe("secret obfuscation", () => {
  it("round-trips ASCII", () => {
    expect(deobfuscate(obfuscate("hunter2"))).toBe("hunter2");
  });
  it("round-trips unicode", () => {
    expect(deobfuscate(obfuscate("pä$$wörd—🔐"))).toBe("pä$$wörd—🔐");
  });
  it("empty maps to empty both ways", () => {
    expect(obfuscate("")).toBe("");
    expect(deobfuscate("")).toBe("");
  });
  it("actually transforms (output != input)", () => {
    expect(obfuscate("hunter2")).not.toBe("hunter2");
  });
});
