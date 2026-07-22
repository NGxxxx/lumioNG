import { defineConfig, configDefaults } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  // @testing-library/svelte 5 + Svelte 5: resolve the client (browser) build so
  // `mount` is available under jsdom; otherwise Svelte resolves its SSR export.
  resolve: {
    conditions: ["browser"],
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
    },
  },
  test: {
    environment: "jsdom",
    // jsdom setup is the biggest cost in this suite; only tests that touch browser globals need it, everything else runs under "node".
    environmentMatchGlobs: [
      ["src/lib/stores/collectionView.test.ts", "jsdom"], // Object.defineProperty(navigator, "clipboard", ...)
      ["src/lib/stores/queryScript.test.ts", "jsdom"], // Object.defineProperty(navigator, "clipboard", ...)
      ["src/lib/stores/settings.test.ts", "jsdom"], // localStorage
      ["src/lib/stores/theme.test.ts", "jsdom"], // document.documentElement
      ["src/lib/stores/uiSize.test.ts", "jsdom"], // document.documentElement
      ["src/lib/stores/platform.test.ts", "jsdom"], // Object.defineProperty(navigator, "platform", ...)
      ["src/lib/stores/**", "node"],
      ["src/lib/domain/**", "node"], // pure logic per CLAUDE.md — no Tauri, no Svelte, no DOM
      ["src/lib/api/**", "node"], // thin invoke() wrappers — no DOM
    ],
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
