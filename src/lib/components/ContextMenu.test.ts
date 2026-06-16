import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ContextMenu from "./ContextMenu.svelte";

describe("ContextMenu", () => {
  it("click item bật → onselect với action", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const { getByText } = render(ContextMenu, {
      props: { x: 0, y: 0, items: [{ label: "Copy value", action: "copyValue" }], onselect, onclose },
    });
    await fireEvent.click(getByText("Copy value"));
    expect(onselect).toHaveBeenCalledWith("copyValue");
  });

  it("item disabled → không gọi onselect", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const { getByText } = render(ContextMenu, {
      props: { x: 0, y: 0, items: [{ label: "Edit cell", action: "editCell", disabled: true }], onselect, onclose },
    });
    await fireEvent.click(getByText("Edit cell"));
    expect(onselect).not.toHaveBeenCalled();
  });
});
