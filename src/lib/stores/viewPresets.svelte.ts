// Named view presets per connection/db/collection, kept in local storage next to the grid layout.
import { parsePresets, upsertPreset, type ViewPreset } from "../domain/viewPresets";

export const PRESETS_KEY = "lumio.viewPresets.v1";

function readAll(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function createViewPresets() {
  // Namespaces written this session; others are read from storage. Only writes touch this state, so
  // list() is safe to call from a $derived.
  let cache = $state.raw<Record<string, ViewPreset[]>>({});

  function list(ns: string): ViewPreset[] {
    return cache[ns] ?? parsePresets(readAll()[ns]);
  }

  function write(ns: string, next: ViewPreset[]) {
    cache = { ...cache, [ns]: next };
    const all = readAll();
    if (next.length) all[ns] = next;
    else delete all[ns];
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
    } catch {
      // storage unavailable: presets last for this session only
    }
  }

  return {
    list,
    save: (ns: string, preset: ViewPreset) => write(ns, upsertPreset(list(ns), preset)),
    remove: (ns: string, name: string) => write(ns, list(ns).filter((p) => p.name !== name)),
  };
}

export const viewPresets = createViewPresets();
