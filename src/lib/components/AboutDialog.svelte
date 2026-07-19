<!-- src/lib/components/AboutDialog.svelte -->
<script lang="ts">
  import { portal } from "../actions/portal";
  import { getAppVersion } from "$lib/api/app";
  import * as m from "$lib/paraglide/messages";

  let { onclose }: { onclose: () => void } = $props();

  let version = $state("");
  getAppVersion().then((v) => (version = v)).catch(() => {});
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.menu_about()}>
    <div class="body">
      <svg class="logo" width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke="var(--accent)" stroke-width="1.6" />
        <path d="M5 5.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6" fill="none" stroke="var(--accent)" stroke-width="1.6" />
      </svg>
      <div class="name">LumioNG</div>
      <div class="tagline">{m.about_dialog_tagline()}</div>
      {#if version}<div class="version">{m.about_dialog_version({ version })}</div>{/if}
      <div class="author">{m.about_dialog_author({ author: "NG" })}</div>
    </div>
    <footer>
      <button onclick={onclose}>{m.common_close()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 18.75rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  .body { padding: 1.5rem 1rem 1rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.1875rem; }
  .logo { margin-bottom: 0.5rem; }
  .name { font-size: 1rem; font-weight: 600; color: var(--fg); }
  .tagline, .version, .author { font-size: 0.75rem; color: var(--muted); }
  footer { display: flex; justify-content: center; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover { background: var(--bg); }
</style>
