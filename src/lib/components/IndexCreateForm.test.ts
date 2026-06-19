import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import IndexCreateForm from "./IndexCreateForm.svelte";

describe("IndexCreateForm", () => {
  it("submit gọi onsubmit với (rows, unique, name)", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("field-0"), { target: { value: "email" } });
    await fireEvent.click(getByText("Create"));
    expect(onsubmit).toHaveBeenCalledWith([{ field: "email", dir: 1 }], false, "");
  });

  it("＋ field thêm dòng field-1", async () => {
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit: vi.fn().mockResolvedValue(undefined), oncancel: vi.fn() },
    });
    await fireEvent.click(getByText("＋ field"));
    expect(getByLabelText("field-1")).toBeTruthy();
  });

  it("onsubmit reject → lỗi inline", async () => {
    const onsubmit = vi.fn().mockRejectedValue("Cần ít nhất một field.");
    const { getByText, findByText } = render(IndexCreateForm, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.click(getByText("Create"));
    expect(await findByText("Cần ít nhất một field.")).toBeTruthy();
  });
});
