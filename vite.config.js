// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, createLogger } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

const host = process.env.TAURI_DEV_HOST;

// Drop the harmless "cannot interpret @__PURE__" warning from Svelte 5 codegen. It goes straight to the
// logger (not rollupOptions.onwarn), so it has to be filtered here.
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
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ fallback: "index.html" }),
      paths: { relative: false },
    }),
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
