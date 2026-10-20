import { describe, it, expect } from "vitest";
import { parseAuditScope, rangeBounds, connectionLabels, filterByConnection, filterText, type AuditEntry } from "./audit";

const e = (label: string): AuditEntry => ({
  ts: 1, os_user: "u", app_version: "1", session_label: label, environment: "prod", op: "update_many",
  ns: "a.b", filter_redacted: null, count: 1, ok: true, error: null, source: "ui", prev_hash: "0",
});

describe("audit domain", () => {
  it("defaults to PROD only and rejects unknown scopes", () => {
    expect(parseAuditScope(null)).toBe("prod");
    expect(parseAuditScope("everything")).toBe("prod");
    expect(parseAuditScope("staging_prod")).toBe("staging_prod");
    expect(parseAuditScope("all")).toBe("all");
  });

  it("computes range bounds ending now", () => {
    expect(rangeBounds("24h", 100_000_000)).toEqual([100_000_000 - 86_400_000, 100_000_000]);
    expect(rangeBounds("all", 5)).toEqual([0, 5]);
    expect(rangeBounds("7d", 8 * 86_400_000)[0]).toBe(86_400_000);
  });

  it("lists distinct labels and filters by connection", () => {
    const list = [e("B"), e("A"), e("B"), e("")];
    expect(connectionLabels(list)).toEqual(["A", "B"]);
    expect(filterByConnection(list, "B")).toHaveLength(2);
    expect(filterByConnection(list, "")).toHaveLength(4);
  });

  it("renders a filter compactly", () => {
    expect(filterText({ a: "<str:3>" })).toBe('{"a":"<str:3>"}');
    expect(filterText(null)).toBe("");
  });
});
