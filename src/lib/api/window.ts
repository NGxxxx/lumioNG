// src/lib/api/window.ts
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Đóng cửa sổ app (File → Quit). */
export async function quit(): Promise<void> {
  await getCurrentWindow().close();
}

/** Thu nhỏ cửa sổ. */
export async function minimize(): Promise<void> {
  await getCurrentWindow().minimize();
}

/** Bật/tắt phóng to cửa sổ. */
export async function toggleMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}
