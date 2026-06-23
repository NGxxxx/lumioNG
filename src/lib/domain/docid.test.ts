import { describe, it, expect } from "vitest";
import { idJson } from "./docid";

describe("idJson", () => {
  it("serializes _id as Canonical ExtJSON", () => {
    expect(idJson({ _id: { $oid: "507f1f77bcf86cd799439011" }, x: 1 })).toBe(
      '{"$oid":"507f1f77bcf86cd799439011"}',
    );
  });
  it("no _id → null", () => {
    expect(idJson({ x: 1 })).toBeNull();
  });
});
