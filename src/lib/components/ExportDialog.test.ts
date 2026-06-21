import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ExportDialog from "./ExportDialog.svelte";

describe("ExportDialog", () => {
  it("shows scope summary and exports selected format", async () => {
    const onexport = vi.fn();
    const { getByText, getByLabelText } = render(ExportDialog, {
      props: { scope: { kind: "selection", count: 3 }, onexport, oncancel: vi.fn() },
    });
    expect(getByText(/3/)).toBeTruthy();
    await fireEvent.click(getByLabelText("CSV"));
    await fireEvent.click(getByText("Export"));
    expect(onexport).toHaveBeenCalledWith("csv");
  });
});
