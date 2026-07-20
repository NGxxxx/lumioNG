<!-- src/lib/components/AboutDialog.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { getAppVersion } from "$lib/api/app";
  import { pushModal } from "$lib/stores/modalStack";
  import appIcon from "$lib/assets/app-icon.png";
  import * as m from "$lib/paraglide/messages";

  let { onclose }: { onclose: () => void } = $props();

  let version = $state("");
  getAppVersion().then((v) => (version = v)).catch(() => {});

  onMount(() => pushModal({ onEscape: onclose, onEnter: onclose }));
</script>

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
      <div class="icon-tile">
        <img class="logo" src={appIcon} alt="" width="64" height="64" />
      </div>
      <div class="name">LumioNG</div>
      <div class="tagline">{m.about_dialog_tagline()}</div>
      <div class="meta">
        {#if version}<span class="version">{m.about_dialog_version({ version })}</span>{/if}
        {#if version}<span class="dot" aria-hidden="true">·</span>{/if}
        <span class="author">{m.about_dialog_author({ author: "NG" })}</span>
      </div>
    </div>
    <footer>
      <button onclick={onclose}>{m.common_close()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 20rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25); }
  .body { padding: 1.75rem 1.25rem 1.25rem; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .icon-tile {
    width: 4.5rem; height: 4.5rem; border-radius: 0.875rem; margin-bottom: 0.875rem;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg); border: 1px solid var(--border);
  }
  .logo { width: 2.75rem; height: 2.75rem; display: block; }
  .name { font-size: 1.0625rem; font-weight: 700; color: var(--fg); letter-spacing: -0.01em; }
  .tagline {
    margin-top: 0.375rem; font-size: 0.6875rem; color: var(--slate); background: var(--blue-tint5);
    padding: 0.125rem 0.5rem; border-radius: 0.1875rem;
  }
  .meta { margin-top: 0.875rem; font-size: 0.75rem; color: var(--muted); display: flex; align-items: center; gap: 0.375rem; }
  .version { font-family: var(--mono); background: var(--tab-inactive-bg); border-radius: 0.1875rem; padding: 0.0625rem 0.3125rem; }
  .dot { color: var(--gray-b8); }
  footer { display: flex; justify-content: center; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover { background: var(--bg); }
</style>
