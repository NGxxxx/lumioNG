/** Test-only double for `createGridfsFiles`, used exclusively by `gridfsFilesCache.test.ts` to prove
 *  that a stale same-key cache entry's `dispose()` (the `$effect.root` teardown) is actually invoked
 *  on a version bump -- a plain object double can't observe that, since `$effect.root`'s cleanup
 *  only runs teardown callbacks registered via a real `$effect`. */
export function createTrackedGridfsFiles(onDispose: () => void): Record<string, never> {
  $effect(() => onDispose);
  return {};
}
