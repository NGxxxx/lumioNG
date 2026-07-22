import { defineConfig, createLogger } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

const host = process.env.TAURI_DEV_HOST;

// Svelte 5's runes codegen sometimes places a `/* @__PURE__ */` annotation where Rollup can't parse
// it (e.g. `$.get(x /* @__PURE__ */).size`). Cosmetic only — the build still succeeds, Rollup just
// strips the malformed comment — so drop this one noisy warning rather than the build's whole output.
// (build.rollupOptions.onwarn doesn't reliably see it — SvelteKit's own Vite build pipeline logs this
// particular warning straight through the logger rather than Rollup's onwarn hook.)
const logger = createLogger();
const rawWarn = logger.warn.bind(logger);
/**
 * @param {string} msg
 * @param {import("vite").LogOptions} [options]
 */
logger.warn = (msg, options) => {
  if (msg.includes("@__PURE__") && msg.includes("cannot interpret")) return;
  rawWarn(msg, options);
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  customLogger: logger,
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    sveltekit(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
