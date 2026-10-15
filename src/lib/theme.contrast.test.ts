// src/lib/theme.contrast.test.ts — every text colour in both themes stays readable (WCAG contrast).
// Reads the primitives straight from app.css so a palette change can't silently thin the text again.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// (jsdom gives import.meta.url a non-file scheme, so resolve from the project root vitest runs in)
const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const LIGHT = block(":root");
const DARK = { ...LIGHT, ...block(':root[data-theme="mocha"]') };

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** color-mix(in srgb, a p%, b) */
const mix = (a: string, p: number, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
};
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("%s theme contrast", (_name, t) => {
  const surfaces = { panel: t["c-base"], "app background": t["c-mantle"], popover: t["popover"] };

  it.each(["c-text", "c-subtext1", "c-subtext0", "c-overlay2", "c-overlay1", "c-blue"])(
    "text colour %s is ≥ 4.5:1 on every surface",
    (token) => {
      for (const [where, bg] of Object.entries(surfaces)) {
        expect(contrast(t[token], bg), `${token} on ${where}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("placeholder / disabled grey (overlay0) is ≥ 3:1", () => {
    for (const bg of Object.values(surfaces)) expect(contrast(t["c-overlay0"], bg)).toBeGreaterThanOrEqual(3);
  });

  it("status text is readable on its own tinted background", () => {
    const base = t["c-base"];
    expect(contrast(t["c-red"], mix(t["c-red"], 0.1, base)), "error").toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["c-green"], mix(t["c-green"], 0.14, base)), "ok").toBeGreaterThanOrEqual(4.5);
    const warnFg = mix(t["c-yellow"], 0.65, t["c-text"]);
    expect(contrast(warnFg, mix(t["c-yellow"], 0.12, base)), "warning").toBeGreaterThanOrEqual(4.5);
  });

  it("muted text stays readable on hovered and selected rows", () => {
    const base = t["c-base"];
    expect(contrast(t["c-subtext0"], mix(t["c-text"], 0.06, base))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["c-subtext0"], mix(t["c-blue"], 0.12, base))).toBeGreaterThanOrEqual(4.5);
  });
});
