<script lang="ts">
  import { errorMessage } from "../api/errors";
  import { portal } from "../actions/portal";
  import * as m from "$lib/paraglide/messages";

  let {
    title,
    message,
    expectedName,
    onconfirm,
    oncancel,
  }: {
    title: string;
    message: string;
    expectedName: string;
    onconfirm: () => Promise<void> | void;
    oncancel: () => void;
  } = $props();

  let typed = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let matches = $derived(typed === expectedName);

  async function confirm() {
    busy = true;
    error = null;
    try {
      await onconfirm();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && !busy && oncancel()} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && !busy) oncancel();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      <p>{message}</p>
      <p>{m.drop_dialog_confirm_prefix()} <code>{expectedName}</code> {m.drop_dialog_confirm_suffix()}</p>
      <input bind:value={typed} disabled={busy} aria-label="confirm-name" />
      {#if error}<div class="dlg-error">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel} disabled={busy}>{m.common_cancel()}</button>
      <button class="danger" disabled={!matches || busy} onclick={confirm}>
        {#if busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{m.drop_dialog_drop()}{/if}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  code { background: var(--bg); padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { display: inline-flex; align-items: center; gap: 0.375rem; height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  .danger { color: var(--error); }
  .danger:disabled { color: var(--gray-b8); }
  .dlg-spinner {
    width: 0.75rem; height: 0.75rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: dlg-spin 0.7s linear infinite;
  }
  @keyframes dlg-spin { to { transform: rotate(360deg); } }
</style>
