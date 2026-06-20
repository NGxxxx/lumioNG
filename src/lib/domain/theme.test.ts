import { describe, it, expect } from "vitest";
import { bsonTypeBadge, statusPill, jsonValueColor } from "./theme";

describe("bsonTypeBadge", () => {
  it("map kiểu đã biết", () => {
    expect(bsonTypeBadge("ObjectId")).toEqual({ color: "#6b3fa0", bg: "#f1ecf8" });
    expect(bsonTypeBadge("String")).toEqual({ color: "#1f7a37", bg: "#e9f5ed" });
    expect(bsonTypeBadge("Double")).toEqual({ color: "#1c00cf", bg: "#e9ecfb" });
    expect(bsonTypeBadge("Boolean")).toEqual({ color: "#aa0d91", bg: "#fbe9f6" });
    expect(bsonTypeBadge("Date")).toEqual({ color: "#267f4e", bg: "#e7f3ec" });
  });
  it("kiểu lạ → trung tính", () => {
    expect(bsonTypeBadge("Whatever")).toEqual({ color: "#555", bg: "#eee" });
  });
});

describe("statusPill", () => {
  it("trạng thái đã biết", () => {
    expect(statusPill("paid")).toEqual({ color: "#1f7a37", bg: "#e6f4ea" });
    expect(statusPill("cancelled")).toEqual({ color: "#c0392b", bg: "#fdeaea" });
  });
  it("không khớp → trung tính", () => {
    expect(statusPill("zzz")).toEqual({ color: "#666", bg: "#ededed" });
  });
});

describe("jsonValueColor", () => {
  it("trả màu theo loại token", () => {
    expect(jsonValueColor("string")).toBe("#c41a16");
    expect(jsonValueColor("number")).toBe("#1c00cf");
    expect(jsonValueColor("objectid")).toBe("#6b3fa0");
    expect(jsonValueColor("null")).toBe("#777");
  });
});
