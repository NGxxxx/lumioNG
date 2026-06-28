import { describe, it, expect } from "vitest";
import { bsonTypeBadge, statusPill, jsonValueColor, bsonValueKind } from "./theme";
import type { BsonType } from "./extjson";

describe("bsonTypeBadge", () => {
  it("maps every concrete BsonType to a non-neutral badge", () => {
    const types: BsonType[] = [
      "objectId", "date", "int", "long", "double", "decimal",
      "binary", "string", "bool", "object", "array",
    ];
    for (const t of types) {
      expect(bsonTypeBadge(t).bg).not.toBe("#eee"); // NEUTRAL_BADGE.bg
    }
  });

  it("returns the neutral badge for unknown", () => {
    expect(bsonTypeBadge("unknown")).toEqual({ color: "#555", bg: "#eee" });
  });
});

describe("statusPill", () => {
  it("known statuses map to their pill colors", () => {
    expect(statusPill("paid")).toEqual({ color: "#1f7a37", bg: "#e6f4ea" });
    expect(statusPill("cancelled")).toEqual({ color: "#c0392b", bg: "#fdeaea" });
  });
  it("unknown status falls back to neutral", () => {
    expect(statusPill("zzz")).toEqual({ color: "#666", bg: "#ededed" });
  });
});

describe("jsonValueColor", () => {
  it("returns the color for a token kind", () => {
    expect(jsonValueColor("string")).toBe("#c41a16");
    expect(jsonValueColor("number")).toBe("#1c00cf");
    expect(jsonValueColor("objectid")).toBe("#6b3fa0");
    expect(jsonValueColor("null")).toBe("#777");
  });
});

describe("bsonValueKind", () => {
  it("maps scalar BSON types to their color kind", () => {
    expect(bsonValueKind("string")).toBe("string");
    expect(bsonValueKind("int")).toBe("number");
    expect(bsonValueKind("long")).toBe("number");
    expect(bsonValueKind("double")).toBe("number");
    expect(bsonValueKind("decimal")).toBe("number");
    expect(bsonValueKind("bool")).toBe("bool");
    expect(bsonValueKind("objectId")).toBe("objectid");
    expect(bsonValueKind("date")).toBe("date");
    expect(bsonValueKind("null")).toBe("null");
  });
  it("returns null for types without a dedicated value color", () => {
    expect(bsonValueKind("object")).toBeNull();
    expect(bsonValueKind("array")).toBeNull();
    expect(bsonValueKind("binary")).toBeNull();
    expect(bsonValueKind("unknown")).toBeNull();
  });
});
