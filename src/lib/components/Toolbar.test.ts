// src/lib/components/Toolbar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Toolbar from "./Toolbar.svelte";
import { settings } from "../stores/settings.svelte";

const base = { connected: true, canNewDoc: true, onsession: vi.fn(), onrefresh: vi.fn(), onnewdocument: vi.fn(), onToggleLog: vi.fn() };

describe("Toolbar", () => {
  it("Session manager is always enabled and calls onsession", async () => {
    const onsession = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false, onsession } });
    const btn = getByLabelText("Session manager") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onsession).toHaveBeenCalled();
  });

  it("Refresh is disabled when not connected", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false } });
    expect((getByLabelText("Refresh") as HTMLButtonElement).disabled).toBe(true);
  });

  it("New document is disabled when no collection is active", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, canNewDoc: false } });
    expect((getByLabelText("New document") as HTMLButtonElement).disabled).toBe(true);
  });

  it("contextual button (Run query) is disabled in default state", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Run query") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Command log is always enabled and calls onToggleLog", async () => {
    const onToggleLog = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, onToggleLog } });
    const btn = getByLabelText("Command log") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onToggleLog).toHaveBeenCalled();
  });
});

describe("Toolbar Wrap toggle", () => {
  beforeEach(() => settings.setWrapLongLines(false));

  it("is always enabled and toggles settings.wrapLongLines on each click", async () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    const btn = getByLabelText("Wrap") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(settings.wrapLongLines).toBe(false);
    await fireEvent.click(btn);
    expect(settings.wrapLongLines).toBe(true);
    await fireEvent.click(btn);
    expect(settings.wrapLongLines).toBe(false);
  });
});

describe("Toolbar Run query", () => {
  it("is disabled when canRun is false", () => {
    const { getByTitle } = render(Toolbar, { props: { ...base, canRun: false, onrun: vi.fn() } });
    expect((getByTitle("Run query") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onrun when enabled and clicked", async () => {
    const onrun = vi.fn();
    const { getByTitle } = render(Toolbar, { props: { ...base, canRun: true, onrun } });
    await fireEvent.click(getByTitle("Run query"));
    expect(onrun).toHaveBeenCalled();
  });
});

describe("Toolbar Explain", () => {
  it("is disabled when canExplainQuery is false (default)", () => {
    const { getByTitle } = render(Toolbar, { props: { ...base } });
    expect((getByTitle("Explain") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onexplainquery when enabled and clicked", async () => {
    const onexplainquery = vi.fn();
    const { getByTitle } = render(Toolbar, {
      props: { ...base, canExplainQuery: true, onexplainquery },
    });
    await fireEvent.click(getByTitle("Explain"));
    expect(onexplainquery).toHaveBeenCalled();
  });
});
