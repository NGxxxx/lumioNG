import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NewDatabaseDialog from "./NewDatabaseDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("NewDatabaseDialog", () => {
  it("submit calls onsubmit with trimmed (db, coll) values", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(NewDatabaseDialog, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Database name"), { target: { value: " shop " } });
    await fireEvent.input(getByLabelText("First collection"), { target: { value: " users " } });
    await fireEvent.click(getByText("Create"));
    expect(onsubmit).toHaveBeenCalledWith("shop", "users");
  });

  it("Enter submits the current (db, coll) values", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText } = render(NewDatabaseDialog, { props: { onsubmit, oncancel: vi.fn() } });
    await fireEvent.input(getByLabelText("Database name"), { target: { value: "shop" } });
    await fireEvent.input(getByLabelText("First collection"), { target: { value: "users" } });
    handleModalKeydown(key("Enter"));
    expect(onsubmit).toHaveBeenCalledWith("shop", "users");
  });

  it("Escape calls oncancel", () => {
    const oncancel = vi.fn();
    render(NewDatabaseDialog, { props: { onsubmit: vi.fn(), oncancel } });
    handleModalKeydown(key("Escape"));
    expect(oncancel).toHaveBeenCalled();
  });
});
