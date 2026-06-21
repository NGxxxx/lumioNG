import { describe, it, expect } from "vitest";
import { validateProfile } from "./connections";
import type { ConnectionProfile } from "./connuri";

const ok: ConnectionProfile = {
  scheme: "mongodb", host: "localhost", port: 27017, authMethod: "none",
  user: "", authSource: "", replicaSet: "", tls: false, extraOptions: "",
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
