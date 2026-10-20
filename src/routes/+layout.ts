import { prefs } from "../lib/stores/prefs.svelte";

// Tauri has no Node server for SSR, so adapter-static + SPA fallback (see https://svelte.dev/docs/kit/single-page-apps).
export const ssr = false;

// Every UI store reads its saved value synchronously, so prefs.json must be in memory before anything renders.
export const load = async () => {
  await prefs.hydrate();
};
