/** Pure helpers for session identity, color allocation, and labels. No Tauri, no Svelte. */
export const SESSION_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
  "#a855f7", "#06b6d4", "#ec4899", "#84cc16",
] as const;

export function savedSessionId(connId: number): string {
  return `conn:${connId}`;
}

export function adhocSessionId(seq: number): string {
  return `adhoc:${seq}`;
}

export function adhocLabel(seq: number): string {
  return `Session #${seq}`;
}

/** First palette color not in `usedColors`; wraps to the start when all are taken. */
export function allocColor(usedColors: string[]): string {
  const free = SESSION_COLORS.find((c) => !usedColors.includes(c));
  return free ?? SESSION_COLORS[usedColors.length % SESSION_COLORS.length];
}
