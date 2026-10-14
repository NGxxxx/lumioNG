import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import DestructiveConfirm from "./DestructiveConfirm.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("DestructiveConfirm", () => {
  it("Escape calls oncancel", () => {
    const oncancel = vi.fn();
    render(DestructiveConfirm, { props: { ops: ["delete"], onrun: vi.fn(), oncancel, ondontask: vi.fn() } });
    handleModalKeydown(key("Escape"));
    expect(oncancel).toHaveBeenCalled();
  });

  it("Enter calls onrun — the same danger action bound to the dialog's own primary button", () => {
    const onrun = vi.fn();
    render(DestructiveConfirm, { props: { ops: ["delete"], onrun, oncancel: vi.fn(), ondontask: vi.fn() } });
    handleModalKeydown(key("Enter"));
    expect(onrun).toHaveBeenCalled();
  });
});
