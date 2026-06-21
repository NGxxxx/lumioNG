import { describe, it, expect } from "vitest";
import { portal } from "./portal";

describe("portal", () => {
  it("moves the node to document.body and removes it on destroy", () => {
    const node = document.createElement("div");
    node.textContent = "overlay";
    const ret = portal(node);
    expect(node.parentNode).toBe(document.body);
    ret.destroy();
    expect(node.parentNode).toBeNull();
  });
});
