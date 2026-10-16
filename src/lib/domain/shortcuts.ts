// src/lib/domain/shortcuts.ts

/** Cmd on macOS, Ctrl everywhere else — see stores/platform.ts for detection. */
export type Platform = "mac" | "other";

type ParsedCombo = { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

function parseCombo(combo: string, platform: Platform): ParsedCombo {
  const parts = combo.split("+");
  const key = parts[parts.length - 1].toLowerCase();
  const mods = new Set(parts.slice(0, -1));
  const mac = platform === "mac";
  return {
    key,
    ctrl: mods.has("Mod") ? !mac : mods.has("Ctrl"),
    meta: mods.has("Mod") ? mac : mods.has("Meta"),
    shift: mods.has("Shift"),
    alt: mods.has("Alt"),
  };
}

/** Does this keydown event match a combo string like `"Mod+Shift+F9"`? `Mod` resolves per platform. */
export function matchesEvent(combo: string, e: KeyboardEvent, platform: Platform): boolean {
  if (!e.key) return false;
  const p = parseCombo(combo, platform);
  // With Alt held, mac Option / AltGr layouts turn the key into another character ("å" for A),
  // so letters and digits fall back to the physical key code.
  const physical = e.altKey && typeof e.code === "string"
    ? /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ?? /^Digit([0-9])$/.exec(e.code)?.[1]
    : undefined;
  if (e.key.toLowerCase() !== p.key && physical !== p.key) return false;
  if (e.ctrlKey !== p.ctrl) return false;
  if (e.metaKey !== p.meta) return false;
  if (e.shiftKey !== p.shift) return false;
  if (e.altKey !== p.alt) return false;
  return true;
}

const DISPLAY_KEY: Record<string, string> = {
  delete: "Del",
  insert: "Ins",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Combos WebView2 (Windows)/WebKitGTK (Linux)/WKWebView (mac) handle as built-in "browser"
 *  accelerators — reload, find-on-page, print, devtools, zoom, history navigation — meaningless
 *  or actively disruptive in a borderless desktop app (F5/Ctrl+R would reload the whole SPA;
 *  Alt+Left/Backspace would navigate the webview's history out from under the app). `Mod`
 *  resolves per platform exactly like the app's own shortcuts, so this list behaves identically
 *  on every OS the webview engine ships on. Entirely independent of the app's own keydown
 *  dispatch (a plain JS `preventDefault()`, no native/OS API) — see `+page.svelte`'s combined
 *  handler, which always lets the app's own `SHORTCUTS` run first on any overlapping key
 *  (F5, Mod+F, F3, Mod+W, Mod+S, F1). */
const WEBVIEW_ACCELERATOR_COMBOS = [
  "F5", "Mod+R", "Mod+Shift+R", // reload
  "F12", "Mod+Shift+I", "Mod+Shift+J", "Mod+Shift+C", "Mod+U", // devtools / view-source
  "Mod+P", // print
  "Mod+S", // save page
  "Mod+O", // open file
  "Mod+N", "Mod+Shift+N", // new window
  "Mod+W", // close window/tab
  "Mod+F", "F3", "Mod+G", "Mod+Shift+G", // find on page
  "Alt+ArrowLeft", "Alt+ArrowRight", // history navigation
  "Mod+D", "Mod+H", "Mod+J", "Mod+Shift+Delete", // bookmark / history / downloads / clear data
];

/** True when this keydown is a default webview/browser accelerator that should never reach the
 *  OS webview control in this app (see `WEBVIEW_ACCELERATOR_COMBOS`). Zoom (`Mod` +/-/=/0) and
 *  history-back `Backspace` are handled separately: zoom's "+" key reports as `"+"` or `"="`
 *  depending on Shift, which the `Mod+key` combo grammar can't express (`+` is its own separator);
 *  Backspace must still work as a delete key inside any editable field. */
export function isDefaultWebviewAccelerator(e: KeyboardEvent, platform: Platform): boolean {
  if (WEBVIEW_ACCELERATOR_COMBOS.some((combo) => matchesEvent(combo, e, platform))) return true;

  const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
  if (mod && !e.altKey && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) return true;

  if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    const editable = tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
    return !editable;
  }

  return false;
}

/** Display string for a combo, e.g. `"Mod+S"` → `"Ctrl+S"` (Windows/Linux) or `"⌘S"` (mac). */
export function formatCombo(combo: string, platform: Platform): string {
  const mac = platform === "mac";
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const displayMods = mods.map((m) => {
    if (m === "Mod") return mac ? "⌘" : "Ctrl";
    if (m === "Shift") return mac ? "⇧" : "Shift";
    if (m === "Alt") return mac ? "⌥" : "Alt";
    if (m === "Meta") return mac ? "⌘" : "Win";
    return m;
  });
  const displayKey = DISPLAY_KEY[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  const sep = mac ? "" : "+";
  return [...displayMods, displayKey].join(sep);
}

/** Plain Mod+A outside an editable field would "select all" the whole desktop UI — block it.
 *  Mod+Alt+A / Mod+Shift+A are app shortcuts and must reach the dispatcher untouched. */
export function blocksNativeSelectAll(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  if (e.key !== "a" && e.key !== "A") return false;
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  return !(tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true);
}


/** The event target is somewhere the user types (a form field, contenteditable, or a CodeMirror editor),
 *  so single-key and text-editing shortcuts must leave the key to it. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest(".cm-editor") !== null;
}
