import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NameDialog from "./NameDialog.svelte";

describe("NameDialog", () => {
  it("submit calls onsubmit with trimmed value", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(NameDialog, {
      props: { title: "New collection", label: "Tên", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("name-input"), { target: { value: "  users  " } });
    await fireEvent.click(getByText("OK"));
    expect(onsubmit).toHaveBeenCalledWith("users");
  });

  it("onsubmit rejection → shows inline error", async () => {
    const onsubmit = vi.fn().mockRejectedValue("tên xấu");
    const { getByText, getByLabelText, findByText } = render(NameDialog, {
      props: { title: "New collection", label: "Tên", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("name-input"), { target: { value: "a$b" } });
    await fireEvent.click(getByText("OK"));
    expect(await findByText("tên xấu")).toBeTruthy();
  });
});
