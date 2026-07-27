import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "./timing";

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the action once after the delay", () => {
    const debouncer = createDebouncer(100);
    const action = vi.fn();
    debouncer.schedule(action);
    vi.advanceTimersByTime(99);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("re-arms on every schedule() call, running only the last action", () => {
    const debouncer = createDebouncer(100);
    const first = vi.fn();
    const second = vi.fn();
    debouncer.schedule(first);
    vi.advanceTimersByTime(50);
    debouncer.schedule(second);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancel() drops a pending action", () => {
    const debouncer = createDebouncer(100);
    const action = vi.fn();
    debouncer.schedule(action);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(action).not.toHaveBeenCalled();
  });

  it("cancel() is a no-op when nothing is pending", () => {
    const debouncer = createDebouncer(100);
    expect(() => debouncer.cancel()).not.toThrow();
  });
});
