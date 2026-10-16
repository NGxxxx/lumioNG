import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer, formatDuration } from "./timing";

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

describe("formatDuration", () => {
  it("uses ms below a second, one decimal below a minute, then minutes + seconds", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(87.6)).toBe("88 ms");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(59_940)).toBe("59.9 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
  });
});
