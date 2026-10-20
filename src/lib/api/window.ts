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

/** Whether the application window is currently maximized. */
export async function isMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/** Notifies on every maximize/restore (also fires for other resizes; caller just re-reads state). */
export async function onMaximizedChange(callback: (maximized: boolean) => void): Promise<() => void> {
  const win = getCurrentWindow();
  return win.onResized(async () => callback(await win.isMaximized()));
}

/** Shows or hides the operating system's own window frame (title bar and borders). */
export async function setDecorations(on: boolean): Promise<void> {
  await getCurrentWindow().setDecorations(on);
}
