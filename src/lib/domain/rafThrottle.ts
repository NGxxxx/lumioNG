/** Wraps a callback so repeated calls collapse into at most one per animation frame, keeping the
 * latest args — for mousemove-driven drag handlers (column/pane/sidebar resize) that would
 * otherwise write reactive state dozens of times per frame. `cancel()` drops any pending frame
 * (call it on drag end, alongside removing the listener). */
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
