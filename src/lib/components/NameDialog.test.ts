import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NameDialog from "./NameDialog.svelte";

describe("NameDialog", () => {
  it("submit gọi onsubmit với value đã trim", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(NameDialog, {
      props: { title: "New collection", label: "Tên", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("name-input"), { target: { value: "  users  " } });
    await fireEvent.click(getByText("OK"));
    expect(onsubmit).toHaveBeenCalledWith("users");
  });

  it("onsubmit reject → hiển thị lỗi inline", async () => {
    const onsubmit = vi.fn().mockRejectedValue("tên xấu");
    const { getByText, getByLabelText, findByText } = render(NameDialog, {
      props: { title: "New collection", label: "Tên", onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("name-input"), { target: { value: "a$b" } });
    await fireEvent.click(getByText("OK"));
    expect(await findByText("tên xấu")).toBeTruthy();
  });
});
