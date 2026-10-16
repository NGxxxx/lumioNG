import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "paraglide") continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|svelte)$/.test(name) && !name.includes(".test.")) out.push(readFileSync(p, "utf8"));
  }
  return out;
}

describe("i18n messages", () => {
  it("every message key is referenced somewhere (directly, as a _one variant, or by a `prefix_${…}` lookup)", () => {
    const src = sources("src").join("\n");
    const words = new Set(src.match(/[A-Za-z0-9_]+/g));
    const prefixes = [...src.matchAll(/[`"']([a-z0-9_]+_)\$\{/g)].map((m) => m[1]);
    const keys = Object.keys(JSON.parse(readFileSync("messages/en.json", "utf8"))).filter((k) => !k.startsWith("$"));
    const unused = keys.filter(
      (k) => !words.has(k) && !(k.endsWith("_one") && words.has(k.slice(0, -4))) && !prefixes.some((p) => k.startsWith(p)),
    );
    expect(unused).toEqual([]);
  });

  it("en and vi define the same keys", () => {
    const en = Object.keys(JSON.parse(readFileSync("messages/en.json", "utf8"))).sort();
    const vi = Object.keys(JSON.parse(readFileSync("messages/vi.json", "utf8"))).sort();
    expect(vi).toEqual(en);
  });
});
