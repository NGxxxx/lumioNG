import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NewDatabaseDialog from "./NewDatabaseDialog.svelte";

describe("NewDatabaseDialog", () => {
  it("submit calls onsubmit with trimmed (db, coll) values", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(NewDatabaseDialog, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("db-input"), { target: { value: " shop " } });
    await fireEvent.input(getByLabelText("coll-input"), { target: { value: " users " } });
    await fireEvent.click(getByText("Create"));
    expect(onsubmit).toHaveBeenCalledWith("shop", "users");
  });
});
