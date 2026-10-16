import { defineConfig, configDefaults } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Non-component tests that touch browser globals (localStorage, navigator, document) need jsdom.
const DOM_TESTS = [
  "src/lib/domain/shortcuts.test.ts",
  "src/lib/stores/collectionView.test.ts",
  "src/lib/stores/collectionViews.test.ts",
  "src/lib/stores/docPeek.test.ts",
  "src/lib/stores/filterHistory.test.ts",
  "src/lib/stores/gridLayout.test.ts",
  "src/lib/stores/gridfsFilesCache.test.ts",
  "src/lib/stores/jobs.svelte.test.ts",
  "src/lib/stores/overviewPoller.test.ts",
  "src/lib/stores/platform.test.ts",
  "src/lib/stores/queryHistory.test.ts",
  "src/lib/stores/queryScript.test.ts",
  "src/lib/stores/refJump.test.ts",
  "src/lib/stores/refMemory.test.ts",
  "src/lib/stores/settings.test.ts",
  "src/lib/stores/shell.test.ts",
  "src/lib/stores/theme.test.ts",
  "src/lib/stores/uiSize.test.ts",
  "src/lib/stores/viewPresets.test.ts",
];
const NODE_TESTS = ["src/lib/domain/**/*.test.ts", "src/lib/api/**/*.test.ts", "src/lib/stores/**/*.test.ts"];

export default defineConfig({
  plugins: [svelte()],
  // Resolve Svelte's client build so `mount` works under jsdom (otherwise the SSR export is picked).
  resolve: {
    conditions: ["browser"],
  },
  test: {
    globals: true,
    // Several suites assert on calls made at import time, so keep mock history between tests.
    clearMocks: false,
    setupFiles: ["src/test-setup.ts"],
    // jsdom setup dominates the suite's runtime, so only tests that need a DOM get one.
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: NODE_TESTS, exclude: [...configDefaults.exclude, ...DOM_TESTS] },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/lib/*.test.ts", "src/lib/actions/**/*.test.ts", "src/lib/components/**/*.test.ts", ...DOM_TESTS],
        },
      },
    ],
  },
});
