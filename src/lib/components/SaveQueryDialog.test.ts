import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/queryLibrary", () => ({
  loadQueryLibrary: vi.fn().mockResolvedValue([]),
  saveQueryLibrary: vi.fn().mockResolvedValue(undefined),
}));

import SaveQueryDialog from "./SaveQueryDialog.svelte";

describe("SaveQueryDialog", () => {
  it("disables OK until a name is typed, then submits name + root parent", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText, getByText } = render(SaveQueryDialog, { onsubmit, oncancel: () => {} });
    const ok = getByText("OK") as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await fireEvent.input(getByLabelText("name-input"), { target: { value: "  My query  " } });
    expect(ok.disabled).toBe(false);
    await fireEvent.click(ok);
    expect(onsubmit).toHaveBeenCalledWith("My query", null);
  });

  it("cancel fires oncancel", async () => {
    const oncancel = vi.fn();
    const { getByText } = render(SaveQueryDialog, { onsubmit: async () => {}, oncancel });
    await fireEvent.click(getByText("Cancel"));
    expect(oncancel).toHaveBeenCalled();
  });
});
