import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import QuerySettingsPopover from "./QuerySettingsPopover.svelte";
import { settings } from "../stores/settings.svelte";
import { prefs } from "../stores/prefs.svelte";

beforeEach(() => {
  prefs.clear();
  settings.setQueryTimeoutMs(30000);
  settings.setQueryResultCap(1000);
  settings.setQueryResultCapUnlimited(false);
});

describe("QuerySettingsPopover", () => {
  it("is collapsed until the gear is clicked", async () => {
    const { getByText, queryByText } = render(QuerySettingsPopover);
    expect(queryByText("Timeout (ms)")).toBeNull();
    await fireEvent.click(getByText("⚙"));
    expect(queryByText("Timeout (ms)")).toBeTruthy();
  });

  it("writes timeout and cap back to settings on change", async () => {
    const { getByText, container } = render(QuerySettingsPopover);
    await fireEvent.click(getByText("⚙"));
    const inputs = container.querySelectorAll("input");
    await fireEvent.change(inputs[0], { target: { value: "8000" } });
    await fireEvent.change(inputs[1], { target: { value: "55" } });
    expect(settings.queryTimeoutMs).toBe(8000);
    expect(settings.queryResultCap).toBe(55);
  });

  it("toggling No limit (ALL) sets queryResultCapUnlimited and disables the cap input", async () => {
    const { getByText, getByRole, container } = render(QuerySettingsPopover);
    await fireEvent.click(getByText("⚙"));
    const checkbox = getByRole("checkbox", { name: "No limit (ALL)" }) as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(settings.queryResultCapUnlimited).toBe(true);
    const capInput = container.querySelectorAll("input")[1] as HTMLInputElement;
    expect(capInput.disabled).toBe(true);
  });

  it("turns query history recording off and on", async () => {
    const { getByRole, getByLabelText } = render(QuerySettingsPopover);
    await fireEvent.click(getByRole("button", { name: "Run settings" }));
    const box = getByLabelText("Record query history") as HTMLInputElement;
    expect(box.checked).toBe(true);
    await fireEvent.click(box);
    expect(settings.recordQueryHistory).toBe(false);
    await fireEvent.click(box);
    expect(settings.recordQueryHistory).toBe(true);
  });
});
