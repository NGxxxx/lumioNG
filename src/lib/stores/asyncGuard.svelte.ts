/**
 * Shared loading/error/generation bookkeeping for a store whose async load can be superseded by a
 * fresher call while still in flight. Each store still owns its own async body and decides where
 * to check `isCurrent(gen)` between awaits (some loads have several sequential awaits, each of
 * which needs its own staleness check) -- this factory only removes the repeated `loading`/
 * `error`/`generation` field declarations and the `finally { if (gen === generation) ... }`
 * boilerplate around them.
 */
export function createAsyncGuard() {
  let loading = $state(false);
  let error = $state<string | null>(null);
  let generation = 0;

  /** Call at the start of a load: marks loading and bumps the generation. Returns the token to check against later. */
  function begin(): number {
    loading = true;
    return ++generation;
  }

  /** True if `gen` is still the most recent call — false means a newer load has superseded it. */
  function isCurrent(gen: number): boolean {
    return gen === generation;
  }

  /** Call in `finally`: clears loading only if this call is still current. */
  function finish(gen: number) {
    if (gen === generation) loading = false;
  }

  /** Bumps the generation without touching `loading`/`error` -- invalidates any in-flight load (e.g. on disconnect) without changing currently-displayed state. */
  function invalidate() {
    generation++;
  }

  return {
    get loading() { return loading; },
    get error() { return error; },
    setError: (msg: string | null) => { error = msg; },
    setLoading: (v: boolean) => { loading = v; },
    begin,
    isCurrent,
    finish,
    invalidate,
  };
}
