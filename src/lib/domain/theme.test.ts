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
      expect(bsonTypeBadge(t).bg).not.toBe("var(--c-surface0)"); // NEUTRAL_BADGE.bg
    }
  });

  it("returns the neutral badge for unknown", () => {
    expect(bsonTypeBadge("unknown")).toEqual({ color: "var(--c-subtext0)", bg: "var(--c-surface0)" });
  });
});

describe("statusPill", () => {
  it("known statuses map to their pill colors", () => {
    expect(statusPill("paid")).toEqual({
      color: "var(--c-green)",
      bg: "color-mix(in srgb, var(--c-green) 14%, var(--c-base))",
    });
    expect(statusPill("cancelled")).toEqual({
      color: "var(--c-red)",
      bg: "color-mix(in srgb, var(--c-red) 10%, var(--c-base))",
    });
  });
  it("unknown status falls back to neutral", () => {
    expect(statusPill("zzz")).toEqual({ color: "var(--c-subtext0)", bg: "var(--c-surface0)" });
  });
});

describe("jsonValueColor", () => {
  it("returns the color for a token kind", () => {
    expect(jsonValueColor("string")).toBe("var(--c-green)");
    expect(jsonValueColor("number")).toBe("var(--c-blue)");
    expect(jsonValueColor("objectid")).toBe("var(--c-mauve)");
    expect(jsonValueColor("null")).toBe("var(--c-overlay0)");
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
