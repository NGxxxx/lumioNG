import { describe, it, expect, afterEach } from "vitest";
import { pushModal, isModalOpen, handleModalKeydown } from "./modalStack";

function key(k: string, target: { tagName?: string } | null = null): KeyboardEvent {
  return { key: k, target } as unknown as KeyboardEvent;
}

describe("modalStack", () => {
  afterEach(() => {
    // Drain any entry a failed assertion left behind so it can't leak into the next test.
    while (isModalOpen()) handleModalKeydown(key("Escape"));
  });

  it("is empty by default", () => {
    expect(isModalOpen()).toBe(false);
  });

  it("dispatches Escape to the registered handler", () => {
    let escaped = false;
    const pop = pushModal({ onEscape: () => (escaped = true) });
    handleModalKeydown(key("Escape"));
    expect(escaped).toBe(true);
    pop();
  });

  it("dispatches Enter to the registered handler", () => {
    let confirmed = false;
    const pop = pushModal({ onEnter: () => (confirmed = true) });
    handleModalKeydown(key("Enter"));
    expect(confirmed).toBe(true);
    pop();
  });

  it("only the topmost of nested modals receives the key", () => {
    let bottom = false;
    let top = false;
    const popBottom = pushModal({ onEscape: () => (bottom = true) });
    const popTop = pushModal({ onEscape: () => (top = true) });
    handleModalKeydown(key("Escape"));
    expect(top).toBe(true);
    expect(bottom).toBe(false);
    popTop();
    popBottom();
  });

  it("skips Enter when the event target is a textarea", () => {
    let confirmed = false;
    const pop = pushModal({ onEnter: () => (confirmed = true) });
    handleModalKeydown(key("Enter", { tagName: "TEXTAREA" }));
    expect(confirmed).toBe(false);
    pop();
  });

  it("skips Enter when enterDisabled() returns true", () => {
    let confirmed = false;
    const pop = pushModal({ onEnter: () => (confirmed = true), enterDisabled: () => true });
    handleModalKeydown(key("Enter"));
    expect(confirmed).toBe(false);
    pop();
  });

  it("pop removes exactly its own entry, restoring the previous handler", () => {
    let bottom = false;
    const popBottom = pushModal({ onEscape: () => (bottom = true) });
    const popTop = pushModal({ onEscape: () => {} });
    popTop();
    handleModalKeydown(key("Escape"));
    expect(bottom).toBe(true);
    popBottom();
  });

  it("does nothing when the stack is empty", () => {
    expect(() => handleModalKeydown(key("Escape"))).not.toThrow();
  });

  it("does nothing for keys other than Enter/Escape", () => {
    let called = false;
    const pop = pushModal({ onEnter: () => (called = true), onEscape: () => (called = true) });
    handleModalKeydown(key("Tab"));
    expect(called).toBe(false);
    pop();
  });
});
