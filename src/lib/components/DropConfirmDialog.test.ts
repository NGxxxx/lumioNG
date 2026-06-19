import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DropConfirmDialog from "./DropConfirmDialog.svelte";

describe("DropConfirmDialog", () => {
  it("Drop disabled tới khi gõ đúng tên", async () => {
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
});
