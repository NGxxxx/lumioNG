import { defineConfig, configDefaults } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  // @testing-library/svelte 5 + Svelte 5: resolve the client (browser) build so
  // `mount` is available under jsdom; otherwise Svelte resolves its SSR export.
  resolve: {
    conditions: ["browser"],
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
    // Vitest 5 defaults to clearing mock history before each test; several suites assert on calls made at import time.
    clearMocks: false,
    setupFiles: ["src/test-setup.ts"],
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
