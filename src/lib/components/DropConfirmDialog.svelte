<script lang="ts">
  import Modal from "./Modal.svelte";
  import { createAsyncSubmit } from "./asyncSubmit.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let {
    title,
    message,
    expectedName,
    confirmLabel,
    onconfirm,
    oncancel,
  }: {
    title: string;
    message: string;
    expectedName: string;
    confirmLabel?: string;
    onconfirm: () => Promise<void> | void;
    oncancel: () => void;
  } = $props();

  let typed = $state("");
  let matches = $derived(typed === expectedName);

  const asyncSubmit = createAsyncSubmit(async () => { await onconfirm(); });
</script>

<Modal
  {title}
  ondismiss={() => { if (!asyncSubmit.busy) oncancel(); }}
  onenter={asyncSubmit.submit}
  enterDisabled={() => !matches || asyncSubmit.busy}
>
  {#snippet body()}
    <p>{message}</p>
    <p>{m.drop_dialog_confirm_prefix()} <code>{expectedName}</code> {m.drop_dialog_confirm_suffix()}</p>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={typed} disabled={asyncSubmit.busy} aria-label="confirm-name" autofocus />
    {#if asyncSubmit.error}<div class="dlg-error">{asyncSubmit.error}</div>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel} disabled={asyncSubmit.busy}>{m.common_cancel()}</button>
    <button class="danger" disabled={!matches || asyncSubmit.busy} onclick={asyncSubmit.submit}>
      {#if asyncSubmit.busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{confirmLabel ?? m.drop_dialog_drop()}{/if}
    </button>
  {/snippet}
</Modal>
