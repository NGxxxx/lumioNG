// src/lib/stores/platform.ts
import type { Platform } from "../domain/shortcuts";

/** Detects Mod's real key: Cmd on macOS/iOS, Ctrl everywhere else. Call once per site that needs it — cheap, not cached. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const raw = navigator.platform || navigator.userAgent || "";
  return /Mac|iPod|iPhone|iPad/.test(raw) ? "mac" : "other";
}
