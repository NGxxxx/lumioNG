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
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
