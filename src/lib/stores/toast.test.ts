import { describe, it, expect, vi, afterEach } from "vitest";
import { toast } from "./toast.svelte";

afterEach(() => {
  for (const t of [...toast.toasts]) toast.dismiss(t.id);
  vi.useRealTimers();
});

describe("toast", () => {
  it("honors the duration", () => {
    vi.useFakeTimers();
    toast.push("hi", "success", 10_000);
    vi.advanceTimersByTime(9_999);
    expect(toast.toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toast.toasts).toHaveLength(0);
  });

  it("an action runs and dismisses the toast", () => {
    const run = vi.fn();
    const id = toast.push("Deleted 3 documents", "success", 10_000, { label: "Undo", run });
    const t = toast.toasts.find((x) => x.id === id)!;
    expect(t.action?.label).toBe("Undo");
    toast.runAction(id);
    expect(run).toHaveBeenCalled();
    expect(toast.toasts.find((x) => x.id === id)).toBeUndefined();
  });
});
