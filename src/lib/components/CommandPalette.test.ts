import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import CommandPalette from "./CommandPalette.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";
import type { PaletteItem } from "../domain/palette";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

const items: PaletteItem[] = [
  { id: "coll:orders", group: "Collections", label: "orders", detail: "shop" },
  { id: "query.run", group: "Query", label: "Run query", shortcut: "F9" },
  { id: "file.refresh", group: "Actions", label: "Refresh" },
  { id: "off", group: "Actions", label: "Disabled thing", disabled: true },
];

function setup() {
  const onrun = vi.fn();
  const onclose = vi.fn();
  const r = render(CommandPalette, { props: { items, context: ["prod", "shop.orders"], onrun, onclose } });
  return { ...r, onrun, onclose };
}

describe("CommandPalette", () => {
  it("lists enabled items under their group headings, plus the context chips", () => {
    setup();
    expect(screen.getAllByRole("option").map((o) => o.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "orders shop",
      "Run query F9",
      "Refresh",
    ]);
    expect(screen.getByText("Collections")).toBeTruthy();
    expect(screen.getByText("shop.orders")).toBeTruthy();
  });

  it("focuses the input and filters as you type", async () => {
    setup();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: "refr" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent?.trim())).toEqual(["Refresh"]);
  });

  it("shows the empty message when nothing matches", async () => {
    setup();
    await fireEvent.input(screen.getByRole("textbox"), { target: { value: "zzzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No matching/)).toBeTruthy();
  });

  it("Enter runs the active item and closes; arrows move the selection", async () => {
    const { onrun, onclose } = setup();
    const input = screen.getByRole("textbox");
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    handleModalKeydown(key("Enter"));
    expect(onclose).toHaveBeenCalled();
    expect(onrun).toHaveBeenCalledWith("query.run");
  });

  it("ArrowUp from the first item wraps to the last", async () => {
    const { onrun } = setup();
    await fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    handleModalKeydown(key("Enter"));
    expect(onrun).toHaveBeenCalledWith("file.refresh");
  });

  it("clicking an item runs it", async () => {
    const { onrun } = setup();
    await fireEvent.click(screen.getAllByRole("option")[0]);
    expect(onrun).toHaveBeenCalledWith("coll:orders");
  });

  it("Escape closes without running anything", () => {
    const { onrun, onclose } = setup();
    handleModalKeydown(key("Escape"));
    expect(onclose).toHaveBeenCalled();
    expect(onrun).not.toHaveBeenCalled();
  });
});
