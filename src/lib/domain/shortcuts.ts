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
  const p = parseCombo(combo, platform);
  if (e.key.toLowerCase() !== p.key) return false;
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
