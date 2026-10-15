import { describe, it, expect } from "vitest";
import { suggestEnvironment, ENV_META } from "./environment";

describe("suggestEnvironment", () => {
  it.each([
    ["Production", "db.example.com", "prod"],
    ["orders-prod", "", "prod"],
    ["x", "mongo.PROD.internal", "prod"],
    ["staging", "", "staging"],
    ["UAT cluster", "", "staging"],
    ["preprod", "", "staging"],
    ["x", "stag-db1.example.com", "staging"],
    ["dev", "", "dev"],
    ["x", "localhost", "dev"],
    ["x", "127.0.0.1", "dev"],
    ["x", "local.example.com", "dev"],
  ])("%s / %s → %s", (label, host, want) => {
    expect(suggestEnvironment(label, host)).toBe(want);
  });
  it("prod wins over staging and dev", () => {
    expect(suggestEnvironment("dev-prod", "localhost")).toBe("prod");
    expect(suggestEnvironment("staging", "prod.example.com")).toBe("prod");
  });
  it("matches whole words only; nothing → null", () => {
    expect(suggestEnvironment("developer-tools", "")).toBeNull();
    expect(suggestEnvironment("analytics", "db.example.com")).toBeNull();
    expect(suggestEnvironment("", "")).toBeNull();
  });
});

describe("ENV_META", () => {
  it("covers every environment", () => {
    expect(ENV_META).toEqual({
      "": { short: "", tone: null },
      dev: { short: "DEV", tone: "ok" },
      staging: { short: "STG", tone: "warn" },
      prod: { short: "PROD", tone: "danger" },
    });
  });
});
