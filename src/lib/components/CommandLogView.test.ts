import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";
import { commandLog } from "../stores/commandLog.svelte";
import CommandLogView from "./CommandLogView.svelte";

describe("CommandLogView", () => {
  beforeEach(() => commandLog.clear());

  it("renders each command entry", () => {
    commandLog.push("db.test.find({})", "s", 18);
    const { getByText } = render(CommandLogView);
    expect(getByText("db.test.find({})")).toBeTruthy();
  });

  it("renders the entry's timestamp and duration", () => {
    const at = new Date(2026, 0, 1, 14, 32, 7).getTime();
    commandLog.push("db.test.find({})", "s", 18);
    // Overwrite the timestamp the push just set so the assertion is deterministic regardless of
    // wall-clock time when the test runs.
    (commandLog.entries[0] as { at: number }).at = at;
    const { container } = render(CommandLogView);
    expect(container.textContent).toContain("14:32:07");
    expect(container.textContent).toContain("(18ms)");
  });
});
