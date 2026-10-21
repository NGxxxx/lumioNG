import { describe, it, expect, beforeEach } from "vitest";
import { getRemembered, remember, forget, REF_MEMORY_CAP, edgeKey, getEdgeDecisions, setEdgeDecision, clearEdgeDecision } from "./refMemory";
import { prefs } from "./prefs.svelte";

describe("refMemory", () => {
  beforeEach(() => prefs.clear());

  it("remembers, overwrites and forgets", () => {
    expect(getRemembered("k")).toBeNull();
    remember("k", "customers");
    expect(getRemembered("k")).toBe("customers");
    remember("k", "users");
    expect(getRemembered("k")).toBe("users");
    forget("k");
    expect(getRemembered("k")).toBeNull();
  });

  it("caps at 500 entries, evicting the oldest", () => {
    for (let i = 0; i <= REF_MEMORY_CAP; i++) remember(`k${i}`, "c", i);
    expect(getRemembered("k0")).toBeNull();
    expect(getRemembered("k1")).toBe("c");
    expect(getRemembered(`k${REF_MEMORY_CAP}`)).toBe("c");
  });

  it("corrupt storage is ignored", () => {
    prefs.setItem("lumio.refTargets.v1", "{oops");
    expect(getRemembered("k")).toBeNull();
    prefs.setItem("lumio.refTargets.v1", JSON.stringify({ k: { coll: 5 }, j: { coll: "x", at: 1 } }));
    expect(getRemembered("k")).toBeNull();
    expect(getRemembered("j")).toBe("x");
  });

  it("keeps diagram edge decisions per connection and database", () => {
    setEdgeDecision(edgeKey(1, "shop", "orders.userId->users"), "confirmed");
    setEdgeDecision(edgeKey(1, "shop", "orders.itemId->items"), "removed");
    setEdgeDecision(edgeKey(2, "shop", "orders.userId->users"), "removed");
    expect(getEdgeDecisions(1, "shop")).toEqual({ "orders.userId->users": "confirmed", "orders.itemId->items": "removed" });
    expect(getEdgeDecisions(1, "other")).toEqual({});
    clearEdgeDecision(edgeKey(1, "shop", "orders.itemId->items"));
    expect(getEdgeDecisions(1, "shop")).toEqual({ "orders.userId->users": "confirmed" });
    prefs.setItem("lumio.refEdges.v1", "garbage");
    expect(getEdgeDecisions(1, "shop")).toEqual({});
  });
});
