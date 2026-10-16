import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import CommandLog from "./CommandLog.svelte";
import { commandLog } from "../stores/commandLog.svelte";
import { settings } from "../stores/settings.svelte";

vi.mock("../api/commandLog", () => ({
  appendCommandLog: vi.fn(async () => ({ path: "/l/commands-2026-10-16.log", offset: 0, length: 1 })),
  readCommandLog: vi.fn(),
  commandLogDir: vi.fn(async () => "/l"),
  clearCommandLogFiles: vi.fn(async () => 3),
}));
import * as api from "../api/commandLog";

describe("CommandLog", () => {
  beforeEach(() => commandLog.clear());

  it("renders pushed command entries", () => {
    commandLog.push('db.getCollection("c").find({})', "s", 4);
    const { getByText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    expect(getByText('db.getCollection("c").find({})')).toBeTruthy();
  });

  it("toggle button calls onToggle", async () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(CommandLog, { props: { height: 140, onToggle } });
    await fireEvent.click(getByLabelText("Toggle command log"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("Clear button empties the log", async () => {
    commandLog.push("x", "s", 4);
    const { getByText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    await fireEvent.click(getByText("Clear"));
    expect(commandLog.entries.length).toBe(0);
  });

  it("Save to file is off by default; switching it on persists and new commands go to the file", async () => {
    settings.setCommandLogToFile(false);
    const { getByLabelText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    const box = getByLabelText("Save to file") as HTMLInputElement;
    expect(box.checked).toBe(false);
    commandLog.push("before", "s", 1);
    expect(api.appendCommandLog).not.toHaveBeenCalled();
    await fireEvent.click(box);
    expect(settings.commandLogToFile).toBe(true);
    commandLog.push("after", "s", 1);
    expect((api.appendCommandLog as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toBe("after");
    settings.setCommandLogToFile(false);
  });

  it("Delete log files asks first", async () => {
    const { getByText, getAllByText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    await fireEvent.click(getByText("Delete log files"));
    expect(api.clearCommandLogFiles).not.toHaveBeenCalled();
    const buttons = getAllByText("Delete log files");
    await fireEvent.click(buttons[buttons.length - 1]);
    expect(api.clearCommandLogFiles).toHaveBeenCalledTimes(1);
  });
});
