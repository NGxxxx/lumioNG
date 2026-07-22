/** Wraps a callback so repeated calls collapse into at most one per animation frame, keeping the latest args; `cancel()` drops any pending frame. */
export function rafThrottle<Args extends unknown[]>(fn: (...args: Args) => void) {
  let rafId: number | null = null;
  let lastArgs: Args;

  function throttled(...args: Args): void {
    lastArgs = args;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn(...lastArgs);
    });
  }

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return throttled;
}
