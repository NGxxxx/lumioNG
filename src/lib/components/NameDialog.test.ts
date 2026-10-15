import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NameDialog from "./NameDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("NameDialog", () => {
  it("submit calls onsubmit with trimmed value", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(NameDialog, {
      props: { title: "New collection", label: "Name", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Name"), { target: { value: "  users  " } });
    await fireEvent.click(getByText("OK"));
    expect(onsubmit).toHaveBeenCalledWith("users");
  });

  it("onsubmit rejection → shows inline error", async () => {
    const onsubmit = vi.fn().mockRejectedValue("bad name");
    const { getByText, getByLabelText, findByText } = render(NameDialog, {
      props: { title: "New collection", label: "Name", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Name"), { target: { value: "a$b" } });
    await fireEvent.click(getByText("OK"));
    expect(await findByText("bad name")).toBeTruthy();
  });

  it("Enter submits the current value", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText } = render(NameDialog, {
      props: { title: "New collection", label: "Name", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Name"), { target: { value: "users" } });
    handleModalKeydown(key("Enter"));
    expect(onsubmit).toHaveBeenCalledWith("users");
  });

  it("Escape calls oncancel", () => {
    const oncancel = vi.fn();
    render(NameDialog, { props: { title: "New collection", label: "Name", onsubmit: vi.fn(), oncancel } });
    handleModalKeydown(key("Escape"));
    expect(oncancel).toHaveBeenCalled();
  });
});
