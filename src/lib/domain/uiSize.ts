/** UI-size presets driving the root font-size (rem base). Pure; no DOM. */
export type UiSizeKey = "small" | "default" | "large" | "larger";

export const UI_SIZES: { key: UiSizeKey; px: number }[] = [
  { key: "small", px: 14 },
  { key: "default", px: 16 },
  { key: "large", px: 18 },
  { key: "larger", px: 20 },
];

/** Root font-size in px for a preset key; falls back to the default preset. */
export function uiSizePx(key: string): number {
  return (UI_SIZES.find((s) => s.key === key) ?? UI_SIZES[1]).px;
}
