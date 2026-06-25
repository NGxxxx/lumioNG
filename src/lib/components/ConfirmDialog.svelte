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
  .modal { background: #fff; width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .body p { margin: 0 0 0.375rem; }
  code { background: #f3f3f3; padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
</style>
