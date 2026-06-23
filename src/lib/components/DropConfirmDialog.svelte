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
  .modal { background: #fff; width: 420px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 5px 7px; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
  .dlg-error { color: #b71c1c; margin-top: 8px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
  .danger:disabled { color: #bbb; }
</style>
