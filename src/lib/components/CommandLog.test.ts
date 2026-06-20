import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import CommandLog from "./CommandLog.svelte";
import { commandLog } from "../stores/commandLog.svelte";

describe("CommandLog", () => {
  beforeEach(() => commandLog.clear());

  it("hiển thị các dòng lệnh đã push", () => {
    commandLog.push('db.getCollection("c").find({})');
    const { getByText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    expect(getByText('db.getCollection("c").find({})')).toBeTruthy();
  });

  it("nút toggle gọi onToggle", async () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(CommandLog, { props: { height: 140, onToggle } });
    await fireEvent.click(getByLabelText("Toggle command log"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("nút Clear xóa log", async () => {
    commandLog.push("x");
    const { getByText } = render(CommandLog, { props: { height: 140, onToggle: vi.fn() } });
    await fireEvent.click(getByText("Clear"));
    expect(commandLog.entries.length).toBe(0);
  });
});
