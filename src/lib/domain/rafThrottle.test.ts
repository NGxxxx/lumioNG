import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rafThrottle } from "./rafThrottle";

describe("rafThrottle", () => {
  let queued: FrameRequestCallback[] = [];
  let nextId = 1;

  beforeEach(() => {
    queued = [];
    nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      queued.push(cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queued = queued.filter((_, i) => i !== id - 1);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrame() {
    const cbs = queued;
    queued = [];
    for (const cb of cbs) cb(0);
  }

  it("collapses multiple calls within a frame into one, using the latest args", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).not.toHaveBeenCalled();
    flushFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("schedules a new frame after the previous one fires", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled("a");
    flushFrame();
    throttled("b");
    flushFrame();
    expect(fn).toHaveBeenNthCalledWith(1, "a");
    expect(fn).toHaveBeenNthCalledWith(2, "b");
  });

  it("cancel() drops a pending frame without calling fn", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled(1);
    throttled.cancel();
    flushFrame();
    expect(fn).not.toHaveBeenCalled();
  });
});
