import {
  getLocale as resolveLocale,
  setLocale as persistLocale,
  overwriteGetLocale,
  type Locale,
} from "$lib/paraglide/runtime";

/** Reactive app locale so language switches apply LIVE without reloading: overrides Paraglide's `getLocale()` to read this `$state`, so every inline `m.*()` re-renders on change, while persisting via `setLocale(..., { reload: false })`. */
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
