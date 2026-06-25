import { describe, it, expect, vi } from "vitest";
import { registerContextMenu } from "./contextMenuController";

describe("contextMenuController", () => {
  it("registering a new menu closes any already-open menu", () => {
    const closeA = vi.fn();
    registerContextMenu(closeA);
    const closeB = vi.fn();
    const unregB = registerContextMenu(closeB);
    expect(closeA).toHaveBeenCalledTimes(1); // opening B closed A
    expect(closeB).not.toHaveBeenCalled(); // the newly-opened menu is not closed
    unregB();
  });

  it("an unregistered (already-closed) menu is not closed again later", () => {
    const closeA = vi.fn();
    const unregA = registerContextMenu(closeA);
    unregA();
    registerContextMenu(vi.fn())();
    expect(closeA).not.toHaveBeenCalled();
  });

  it("each open supersedes the previous, closing exactly one prior menu", () => {
    const a = vi.fn(), b = vi.fn(), c = vi.fn();
    registerContextMenu(a);
    registerContextMenu(b); // closes a
    registerContextMenu(c)(); // closes b, then unregister c
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
  });
});
