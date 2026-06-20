// src/lib/components/Toolbar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Toolbar from "./Toolbar.svelte";

const base = { connected: true, canNewDoc: true, onsession: vi.fn(), onrefresh: vi.fn(), onnewdocument: vi.fn(), onToggleLog: vi.fn() };

describe("Toolbar", () => {
  it("Session manager luôn enabled và gọi onsession", async () => {
    const onsession = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false, onsession } });
    const btn = getByLabelText("Session manager") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onsession).toHaveBeenCalled();
  });

  it("Refresh disabled khi chưa kết nối", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false } });
    expect((getByLabelText("Refresh") as HTMLButtonElement).disabled).toBe(true);
  });

  it("New document disabled khi không có collection đang chọn", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, canNewDoc: false } });
    expect((getByLabelText("New document") as HTMLButtonElement).disabled).toBe(true);
  });

  it("nút ngữ cảnh (Run query) disabled trong A1", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Run query") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Command log luôn enabled và gọi onToggleLog", async () => {
    const onToggleLog = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, onToggleLog } });
    const btn = getByLabelText("Command log") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onToggleLog).toHaveBeenCalled();
  });
});
