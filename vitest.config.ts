import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  // @testing-library/svelte 5 + Svelte 5: resolve the client (browser) build so
  // `mount` is available under jsdom; otherwise Svelte resolves its SSR export.
  resolve: { conditions: ["browser"] },
  test: { environment: "jsdom", globals: true },
});
