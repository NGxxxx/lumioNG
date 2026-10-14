<script lang="ts">
  import Modal from "./Modal.svelte";
  import * as m from "#lib/paraglide/messages.js";

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

<Modal {title} ondismiss={oncancel} onenter={onconfirm}>
  {#snippet body()}
    <p>{message}</p>
    {#if detail}<p><code>{detail}</code></p>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel}>{resolvedCancelLabel}</button>
    <button class:danger onclick={onconfirm}>{resolvedConfirmLabel}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0 0 0.375rem; }
</style>
