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

<svelte:window onkeydown={(e) => e.key === "Escape" && oncancel()} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) oncancel();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      <p>{message}</p>
      <p>{m.drop_dialog_confirm_prefix()} <code>{expectedName}</code> {m.drop_dialog_confirm_suffix()}</p>
      <input bind:value={typed} aria-label="confirm-name" />
      {#if error}<div class="dlg-error">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel}>{m.common_cancel()}</button>
      <button class="danger" disabled={!matches || busy} onclick={confirm}>{m.drop_dialog_drop()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  code { background: #f3f3f3; padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  .dlg-error { color: #b71c1c; margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
  .danger:disabled { color: #bbb; }
</style>
