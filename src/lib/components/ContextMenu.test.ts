import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ContextMenu from "./ContextMenu.svelte";

describe("ContextMenu", () => {
  it("clicking an enabled item → calls onselect with action", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const { getByText } = render(ContextMenu, {
      props: { x: 0, y: 0, items: [{ label: "Copy value", action: "copyValue" }], onselect, onclose },
    });
    await fireEvent.click(getByText("Copy value"));
    expect(onselect).toHaveBeenCalledWith("copyValue");
  });

  it("disabled item → does not call onselect", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const { getByText } = render(ContextMenu, {
      props: { x: 0, y: 0, items: [{ label: "Edit cell", action: "editCell", disabled: true }], onselect, onclose },
    });
    await fireEvent.click(getByText("Edit cell"));
    expect(onselect).not.toHaveBeenCalled();
  });

  it("submenu: hover parent reveals children; leaf click → onselect(action)", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const items = [
      { label: "Copy", action: "copy", children: [{ label: "Value", action: "copyValue" }] },
    ];
    const { getByRole, getByText } = render(ContextMenu, { props: { x: 0, y: 0, items, onselect, onclose } });
    await fireEvent.mouseEnter(getByRole("menuitem", { name: /Copy/i }));
    await fireEvent.click(getByText("Value"));
    expect(onselect).toHaveBeenCalledWith("copyValue");
  });

  const nested = () => [
    { label: "Run", action: "run" },
    { label: "Off", action: "off", disabled: true },
    { label: "Copy", action: "copy", children: [{ label: "Value", action: "copyValue" }, { label: "Path", action: "copyPath" }] },
  ];

  it("clicking a parent opens its submenu instead of closing the menu", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    const { getByRole, getByText } = render(ContextMenu, { props: { x: 0, y: 0, items: nested(), onselect, onclose } });
    await fireEvent.click(getByRole("menuitem", { name: /Copy/ }));
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.click(getByText("Path"));
    expect(onselect).toHaveBeenCalledWith("copyPath");
  });

  it("opening never takes focus (an inline cell edit must not blur); arrows then enter the menu, skip disabled items and wrap", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const { getByRole } = render(ContextMenu, { props: { x: 0, y: 0, items: nested(), onselect: vi.fn(), onclose: vi.fn() } });
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "Run" }));
    input.remove();
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: /Copy/ }));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "Run" }));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: /Copy/ }));
  });

  it("keyboard: ArrowRight opens a submenu on its first item, ArrowLeft goes back, Enter chooses", async () => {
    const onselect = vi.fn();
    const { getByRole } = render(ContextMenu, { props: { x: 0, y: 0, items: nested(), onselect, onclose: vi.fn() } });
    const parent = getByRole("menuitem", { name: /Copy/ });
    parent.focus();
    await fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "Value" }));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(parent);
    await fireEvent.keyDown(parent, { key: "ArrowRight" });
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "Path" }));
    (document.activeElement as HTMLElement).click();
    expect(onselect).toHaveBeenCalledWith("copyPath");
  });

  it("closing after keyboard use returns focus to where it was", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const { unmount } = render(ContextMenu, { props: { x: 0, y: 0, items: nested(), onselect: vi.fn(), onclose: vi.fn() } });
    await fireEvent.keyDown(before, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(before);
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
