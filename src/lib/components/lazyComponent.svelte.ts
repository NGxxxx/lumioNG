/** Defers a heavy component's chunk until it is first rendered, keeping it — and everything only it
 *  pulls in — out of the eager startup bundle. Reading `.value` starts the load (once) and returns
 *  `null` until the chunk lands, so the caller renders a placeholder in the meantime. */
export function lazyComponent<T>(load: () => Promise<{ default: T }>) {
  let comp = $state<T | null>(null);
  let started = false;
  return {
    get value(): T | null {
      if (!started) {
        started = true;
        load().then(
          (mod) => {
            comp = mod.default;
          },
          () => {
            started = false;
          },
        );
      }
      return comp;
    },
  };
}
