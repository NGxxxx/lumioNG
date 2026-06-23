import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatCount,
  formatPercent,
  parseCollStats,
  parseDbStats,
  parseCollOptions,
} from "./stats";

describe("formatBytes", () => {
  it("null → —", () => expect(formatBytes(null)).toBe("—"));
  it("0 → 0 B", () => expect(formatBytes(0)).toBe("0 B"));
  it("below 1KB → B", () => expect(formatBytes(512)).toBe("512 B"));
  it("KB", () => expect(formatBytes(1536)).toBe("1.5 KB"));
  it("MB", () => expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB"));
  it("GB", () => expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB"));
});

describe("formatCount", () => {
  it("null → —", () => expect(formatCount(null)).toBe("—"));
  it("thousands-grouped", () => expect(formatCount(1234567)).toBe("1,234,567"));
});

const collStatsJson = JSON.stringify({
  ns: "shop.users",
  count: { $numberLong: "1500" },
  size: { $numberLong: "204800" },
  avgObjSize: { $numberInt: "136" },
  storageSize: { $numberLong: "81920" },
  totalIndexSize: { $numberLong: "36864" },
  nindexes: { $numberInt: "2" },
  indexSizes: { _id_: { $numberLong: "20480" }, email_1: { $numberLong: "16384" } },
  capped: false,
});

describe("parseCollStats", () => {
  it("extracts all fields and indexSizes as an array", () => {
    const s = parseCollStats(collStatsJson);
    expect(s.ns).toBe("shop.users");
    expect(s.count).toBe(1500);
    expect(s.avgObjSize).toBe(136);
    expect(s.nindexes).toBe(2);
    expect(s.capped).toBe(false);
    expect(s.size).toBe(204800);
    expect(s.storageSize).toBe(81920);
    expect(s.totalIndexSize).toBe(36864);
    expect(s.indexSizes).toEqual([
      { name: "_id_", bytes: 20480 },
      { name: "email_1", bytes: 16384 },
    ]);
  });
  it("missing fields → null, indexSizes empty", () => {
    const s = parseCollStats("{}");
    expect(s.count).toBeNull();
    expect(s.storageSize).toBeNull();
    expect(s.indexSizes).toEqual([]);
    expect(s.capped).toBe(false);
  });
});

describe("parseDbStats", () => {
  it("extracts all fields", () => {
    const json = JSON.stringify({
      db: "shop",
      collections: { $numberInt: "5" },
      objects: { $numberLong: "12000" },
      dataSize: { $numberLong: "1048576" },
      storageSize: { $numberLong: "524288" },
      indexes: { $numberInt: "8" },
      indexSize: { $numberLong: "131072" },
    });
    const s = parseDbStats(json);
    expect(s.db).toBe("shop");
    expect(s.collections).toBe(5);
    expect(s.objects).toBe(12000);
    expect(s.dataSize).toBe(1048576);
    expect(s.indexes).toBe(8);
  });
  it("missing fields → null", () => {
    expect(parseDbStats("{}").objects).toBeNull();
  });
});

describe("formatPercent", () => {
  it("formats a 0..1 ratio as a rounded percent", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.333)).toBe("33%");
  });
  it("returns dash for null/NaN", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
  });
});

describe("parseCollOptions", () => {
  it("with validator → pretty JSON and level/action", () => {
    const json = JSON.stringify({
      name: "users",
      type: "collection",
      options: {
        validator: { $jsonSchema: { bsonType: "object", required: ["email"] } },
        validationLevel: "strict",
        validationAction: "error",
      },
    });
    const o = parseCollOptions(json);
    expect(o.validationLevel).toBe("strict");
    expect(o.validationAction).toBe("error");
    expect(o.validatorJson).toContain("$jsonSchema");
    expect(o.validatorJson).toContain("\n"); // pretty-printed (multiple lines)
    expect(o.capped).toBe(false);
  });
  it("no validator → validatorJson null", () => {
    const json = JSON.stringify({ name: "x", type: "collection", options: {} });
    const o = parseCollOptions(json);
    expect(o.validatorJson).toBeNull();
    expect(o.rawJson).toBe("{}");
  });
  it("capped options", () => {
    const json = JSON.stringify({
      name: "logs",
      options: { capped: true, size: { $numberLong: "1048576" }, max: { $numberInt: "1000" } },
    });
    const o = parseCollOptions(json);
    expect(o.capped).toBe(true);
    expect(o.size).toBe(1048576);
    expect(o.max).toBe(1000);
    expect(o.rawJson).toContain("\n");
  });
  it("empty doc (\"{}\") → empty options", () => {
    const o = parseCollOptions("{}");
    expect(o.capped).toBe(false);
    expect(o.validatorJson).toBeNull();
    expect(o.rawJson).toBe("{}");
  });
});
