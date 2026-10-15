import { describe, it, expect } from "vitest";
import { valueTextFor, displayValue, editValue, chipParts, OPS_WITHOUT_VALUE, valueCountFor } from "./chipText";

describe("chipText", () => {
  it("turns typed input into value JSON text by type", () => {
    expect(valueTextFor("string", "ann")).toBe('"ann"');
    expect(valueTextFor("number", "100")).toBe("100");
    expect(valueTextFor("number", "1.0")).toBe("1.0");
    expect(valueTextFor("number", "abc")).toBeNull();
    expect(valueTextFor("objectId", "652f1a9e0000000000000c41")).toBe('{"$oid":"652f1a9e0000000000000c41"}');
    expect(valueTextFor("objectId", "xyz")).toBeNull();
    // A bare day is LOCAL midnight (same boundary as today/lastDays); endOfDay is its last ms.
    expect(valueTextFor("date", "2026-10-01")).toBe(JSON.stringify({ $date: new Date(2026, 9, 1).toISOString() }));
    expect(valueTextFor("date", "2026-10-01", { endOfDay: true })).toBe(JSON.stringify({ $date: new Date(2026, 9, 1, 23, 59, 59, 999).toISOString() }));
    expect(valueTextFor("date", "nope")).toBeNull();
    expect(valueTextFor("unknown", "42")).toBe("42");
    expect(valueTextFor("unknown", "ok")).toBe('"ok"');
  });

  it("shows values plainly", () => {
    expect(displayValue('"shipped"')).toBe("shipped");
    expect(displayValue("100")).toBe("100");
    expect(displayValue('{"$oid":"652f1a9e0000000000000c41"}')).toBe("…000c41");
    expect(displayValue(JSON.stringify({ $date: new Date(2026, 9, 1).toISOString() }))).toBe("2026-10-01");
    expect(displayValue(JSON.stringify({ $date: new Date(2026, 9, 1, 23, 59, 59, 999).toISOString() }))).toBe("2026-10-01");
    // canonical ExtJSON from the backend
    const ms = new Date(2026, 9, 1, 14, 5).getTime();
    expect(displayValue(`{"$date":{"$numberLong":"${ms}"}}`)).toBe("2026-10-01 14:05");
    expect(editValue('{"$oid":"652f1a9e0000000000000c41"}')).toBe("652f1a9e0000000000000c41");
    expect(displayValue('{"$numberLong":"9007199254740993"}')).toBe("9007199254740993");
  });

  it("chip parts and value counts per operator", () => {
    expect(chipParts({ field: "total", op: "between", values: ["1", "5"] })).toEqual({ field: "total", op: "between", value: "1 – 5" });
    expect(chipParts({ field: "s", op: "in", values: ['"a"', '"b"'] }).value).toBe("a, b");
    expect(chipParts({ field: "s", op: "exists", values: [] }).value).toBe("");
    expect(OPS_WITHOUT_VALUE.has("today")).toBe(true);
    expect(valueCountFor("between")).toBe(2);
    expect(valueCountFor("in")).toBe("many");
    expect(valueCountFor("eq")).toBe(1);
    expect(valueCountFor("isTrue")).toBe(0);
  });
});
