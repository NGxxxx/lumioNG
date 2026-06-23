<script lang="ts">
  import { portal } from "../actions/portal";
  import * as m from "$lib/paraglide/messages";

  let {
    title,
    message,
    detail = null,
    confirmLabel,
    cancelLabel,
    danger = false,
    onconfirm,
    oncancel,
  }: {
    title: string;
    message: string;
    detail?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  const resolvedConfirmLabel = $derived(confirmLabel ?? m.common_ok());
  const resolvedCancelLabel = $derived(cancelLabel ?? m.common_cancel());
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
      {#if detail}<p><code>{detail}</code></p>{/if}
    </div>
    <footer>
      <button onclick={oncancel}>{resolvedCancelLabel}</button>
      <button class:danger onclick={onconfirm}>{resolvedConfirmLabel}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 420px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  .body p { margin: 0 0 6px; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
</style>
