// src/lib/components/MenuBar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import MenuBar from "./MenuBar.svelte";

const base = { connected: true, onsession: vi.fn(), onrefresh: vi.fn(), onquit: vi.fn() };

describe("MenuBar", () => {
  it("Tools → Session manager gọi onsession", async () => {
    const onsession = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, onsession } });
    await fireEvent.click(getByText("Tools"));
    await fireEvent.click(getByText("Session manager"));
    expect(onsession).toHaveBeenCalled();
  });

  it("File → Refresh gọi onrefresh khi connected", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: true, onrefresh } });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Refresh"));
    expect(onrefresh).toHaveBeenCalled();
  });

  it("File → Refresh bị disabled khi chưa kết nối", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: false, onrefresh } });
    await fireEvent.click(getByText("File"));
    const item = getByText("Refresh") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });
});
