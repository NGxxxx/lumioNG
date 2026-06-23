// src/lib/api/window.ts
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Closes the application window (File → Quit). */
export async function quit(): Promise<void> {
  await getCurrentWindow().close();
}

/** Minimizes the application window. */
export async function minimize(): Promise<void> {
  await getCurrentWindow().minimize();
}

/** Toggles maximize state of the application window. */
export async function toggleMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}
