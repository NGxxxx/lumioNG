import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import QuerySettingsPopover from "./QuerySettingsPopover.svelte";
import { settings } from "../stores/settings.svelte";

beforeEach(() => {
  localStorage.clear();
  settings.setQueryTimeoutMs(30000);
  settings.setQueryResultCap(1000);
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
});
