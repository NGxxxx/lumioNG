import { describe, it, expect, beforeEach } from "vitest";
import { getRemembered, remember, forget, REF_MEMORY_CAP } from "./refMemory";

describe("refMemory", () => {
  beforeEach(() => localStorage.clear());

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
    localStorage.setItem("lumio.refTargets.v1", "{oops");
    expect(getRemembered("k")).toBeNull();
    localStorage.setItem("lumio.refTargets.v1", JSON.stringify({ k: { coll: 5 }, j: { coll: "x", at: 1 } }));
    expect(getRemembered("k")).toBeNull();
    expect(getRemembered("j")).toBe("x");
  });
});
