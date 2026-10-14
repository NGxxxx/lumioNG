import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import BulkDialog from "./BulkDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string, target: { tagName?: string } | null = null): KeyboardEvent {
  return { key: k, target } as unknown as KeyboardEvent;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    mode: "delete" as const,
    scope: "selection" as const,
    appliedFilter: "{}",
    isEmpty: false,
    selectionCount: 3,
    updateText: "",
    updateError: null,
    count: null,
    counting: false,
    running: false,
    result: null,
    error: null,
    canRun: true,
    oncount: vi.fn(),
    onrun: vi.fn(),
    onclose: vi.fn(),
    ...overrides,
  };
}

describe("BulkDialog", () => {
  it("Escape calls onclose", () => {
    const onclose = vi.fn();
    render(BulkDialog, { props: baseProps({ onclose }) });
    handleModalKeydown(key("Escape"));
    expect(onclose).toHaveBeenCalled();
  });

  it("Enter calls onrun when canRun is true", () => {
    const onrun = vi.fn();
    render(BulkDialog, { props: baseProps({ onrun, canRun: true }) });
    handleModalKeydown(key("Enter"));
    expect(onrun).toHaveBeenCalled();
  });

  it("Enter does nothing when canRun is false (e.g. the empty-filter guard)", () => {
    const onrun = vi.fn();
    render(BulkDialog, { props: baseProps({ onrun, canRun: false }) });
    handleModalKeydown(key("Enter"));
    expect(onrun).not.toHaveBeenCalled();
  });

  it("Enter inside the update textarea inserts a newline instead of running", () => {
    const onrun = vi.fn();
    render(BulkDialog, { props: baseProps({ mode: "update", onrun, canRun: true }) });
    handleModalKeydown(key("Enter", { tagName: "TEXTAREA" }));
    expect(onrun).not.toHaveBeenCalled();
  });
});
