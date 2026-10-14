import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DropConfirmDialog from "./DropConfirmDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("DropConfirmDialog", () => {
  it("Drop disabled until correct name is typed", async () => {
    const onconfirm = vi.fn();
    const { getByText, getByLabelText } = render(DropConfirmDialog, {
      props: { title: "Drop collection", message: "msg", expectedName: "users", onconfirm, oncancel: vi.fn() },
    });
    const drop = getByText("Drop") as HTMLButtonElement;
    expect(drop.disabled).toBe(true);
    await fireEvent.input(getByLabelText("confirm-name"), { target: { value: "wrong" } });
    expect(drop.disabled).toBe(true);
    await fireEvent.input(getByLabelText("confirm-name"), { target: { value: "users" } });
    expect(drop.disabled).toBe(false);
    await fireEvent.click(drop);
    expect(onconfirm).toHaveBeenCalled();
  });

  it("Enter does nothing until the typed name matches, then confirms", async () => {
    const onconfirm = vi.fn();
    const { getByLabelText } = render(DropConfirmDialog, {
      props: { title: "Drop collection", message: "msg", expectedName: "users", onconfirm, oncancel: vi.fn() },
    });
    handleModalKeydown(key("Enter"));
    expect(onconfirm).not.toHaveBeenCalled();
    await fireEvent.input(getByLabelText("confirm-name"), { target: { value: "users" } });
    handleModalKeydown(key("Enter"));
    expect(onconfirm).toHaveBeenCalled();
  });

  it("Escape calls oncancel", () => {
    const oncancel = vi.fn();
    render(DropConfirmDialog, {
      props: { title: "Drop collection", message: "msg", expectedName: "users", onconfirm: vi.fn(), oncancel },
    });
    handleModalKeydown(key("Escape"));
    expect(oncancel).toHaveBeenCalled();
  });
});
