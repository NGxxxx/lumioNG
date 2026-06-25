import {
  getLocale as resolveLocale,
  setLocale as persistLocale,
  overwriteGetLocale,
  type Locale,
} from "$lib/paraglide/runtime";

/**
 * Reactive app locale so language switches apply LIVE, without reloading the app.
 *
 * Paraglide compiles every `m.*()` to call `getLocale()` on each invocation. By
 * overriding `getLocale()` to read this reactive `$state`, every inline message in a
 * component template re-renders when the locale changes. The choice is still persisted
 * through Paraglide's `setLocale(..., { reload: false })` (cookie + globalVariable) so it
 * survives a real restart — we just skip the page reload.
 *
 * Caveat: a message captured imperatively (e.g. a status string stored in state at the
 * moment of an action) keeps its original language until re-computed; only live `m.*()`
 * reads switch. In practice the UI calls `m.*()` inline, so it all updates at once.
 */
function createAppLocale() {
  let current = $state<Locale>(resolveLocale());
  overwriteGetLocale(() => current);

  return {
    get current(): Locale {
      return current;
    },
    set(next: Locale) {
      if (next === current) return;
      current = next;
      persistLocale(next, { reload: false });
    },
  };
}

export const appLocale = createAppLocale();
