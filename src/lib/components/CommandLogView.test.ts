import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { commandLog } from "../stores/commandLog.svelte";
import CommandLogView from "./CommandLogView.svelte";
import * as clipboard from "../clipboard";

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

  it("a long command shows its start and opens in full on demand", async () => {
    const long = "db.big.insertOne(" + "x".repeat(5000) + ")";
    commandLog.push(long, "s", 3);
    const { container, getByText } = render(CommandLogView);
    expect(container.querySelector("code")!.textContent!.length).toBe(600);
    await fireEvent.click(getByText(`+${(long.length - 600).toLocaleString("en-US")} chars`));
    await waitFor(() => expect(document.querySelector("pre.text")!.textContent).toBe(long));
  });

  it("Copy copies the whole command", async () => {
    const spy = vi.spyOn(clipboard, "copyToClipboard").mockResolvedValue(true);
    const long = "q".repeat(3000);
    commandLog.push(long, "s", 3);
    const { getByLabelText } = render(CommandLogView);
    await fireEvent.click(getByLabelText("Copy command"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(long));
    spy.mockRestore();
  });
});
