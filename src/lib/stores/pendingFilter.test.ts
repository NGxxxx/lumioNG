import { describe, it, expect } from "vitest";
import { setPendingFilter, takePendingFilter } from "./pendingFilter";

describe("pendingFilter", () => {
  it("is taken exactly once, per session + namespace", () => {
    setPendingFilter("s", "shop", "customers", '{"_id": 1}');
    expect(takePendingFilter("s", "shop", "orders")).toBeNull();
    expect(takePendingFilter("t", "shop", "customers")).toBeNull();
    expect(takePendingFilter("s", "shop", "customers")).toBe('{"_id": 1}');
    expect(takePendingFilter("s", "shop", "customers")).toBeNull();
  });
});
