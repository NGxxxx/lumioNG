import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/svelte";
import ShortcutsDialog from "./ShortcutsDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("ShortcutsDialog", () => {
  it("groups shortcuts and shows aliases next to the primary key", () => {
    const { getByRole } = render(ShortcutsDialog, { props: { platform: "other", onclose: vi.fn() } });
    const grid = getByRole("region", { name: "Grid" });
    const row = within(grid).getByText("Move down").closest("tr")!;
    expect(row.textContent).toContain("↓");
    expect(row.textContent).toContain("J");
  });

  it("formats modifiers per platform", () => {
    const mac = render(ShortcutsDialog, { props: { platform: "mac", onclose: vi.fn() } });
    expect(within(mac.getByRole("region", { name: "General" })).getByText("Command palette").closest("tr")!.textContent).toContain("⌘K");
    mac.unmount();
    const win = render(ShortcutsDialog, { props: { platform: "other", onclose: vi.fn() } });
    expect(within(win.getByRole("region", { name: "General" })).getByText("Command palette").closest("tr")!.textContent).toContain("Ctrl+K");
  });

  it("Escape closes", () => {
    const onclose = vi.fn();
    render(ShortcutsDialog, { props: { platform: "other", onclose } });
    handleModalKeydown(key("Escape"));
    expect(onclose).toHaveBeenCalled();
  });
});
