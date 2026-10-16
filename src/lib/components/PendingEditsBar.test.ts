import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import PendingEditsBar from "./PendingEditsBar.svelte";

describe("PendingEditsBar", () => {
  it("shows the count and commits", async () => {
    const oncommit = vi.fn();
    const { getByText } = render(PendingEditsBar, { props: { count: 3, committing: false, oncommit, ondiscard: vi.fn() } });
    expect(getByText("3 unsaved changes")).toBeTruthy();
    await fireEvent.click(getByText("Commit"));
    expect(oncommit).toHaveBeenCalled();
  });

  it("Discard asks first and only discards on confirm", async () => {
    const ondiscard = vi.fn();
    const { getByText, getAllByText, queryByText } = render(PendingEditsBar, { props: { count: 1, committing: false, oncommit: vi.fn(), ondiscard } });
    await fireEvent.click(getByText("Discard"));
    expect(ondiscard).not.toHaveBeenCalled();
    expect(getByText("Discard 1 unsaved change? The cell goes back to its stored value.")).toBeTruthy();
    await fireEvent.click(getByText("Cancel"));
    expect(queryByText("Discard changes?")).toBeNull();
    await fireEvent.click(getByText("Discard"));
    const buttons = getAllByText("Discard");
    await fireEvent.click(buttons[buttons.length - 1]);
    expect(ondiscard).toHaveBeenCalledTimes(1);
  });

  it("buttons are disabled while committing", () => {
    const { getByText } = render(PendingEditsBar, { props: { count: 2, committing: true, oncommit: vi.fn(), ondiscard: vi.fn() } });
    expect((getByText("Commit").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Discard") as HTMLButtonElement).disabled).toBe(true);
  });
});
