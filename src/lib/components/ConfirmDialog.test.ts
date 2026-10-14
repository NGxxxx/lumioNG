import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("ConfirmDialog", () => {
  it("Escape calls oncancel", () => {
    const oncancel = vi.fn();
    render(ConfirmDialog, { props: { title: "T", message: "M", onconfirm: vi.fn(), oncancel } });
    handleModalKeydown(key("Escape"));
    expect(oncancel).toHaveBeenCalled();
  });

  it("Enter calls onconfirm", () => {
    const onconfirm = vi.fn();
    render(ConfirmDialog, { props: { title: "T", message: "M", onconfirm, oncancel: vi.fn() } });
    handleModalKeydown(key("Enter"));
    expect(onconfirm).toHaveBeenCalled();
  });
});
