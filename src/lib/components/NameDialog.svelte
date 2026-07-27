<script lang="ts">
  import { untrack } from "svelte";
  import Modal from "./Modal.svelte";
  import { createAsyncSubmit } from "./asyncSubmit.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    title,
    label,
    initial = "",
    onsubmit,
    oncancel,
  }: {
    title: string;
    label: string;
    initial?: string;
    onsubmit: (value: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let value = $state(untrack(() => initial));
  const asyncSubmit = createAsyncSubmit(() => onsubmit(value.trim()));
</script>

<Modal
  {title}
  fadeDisabled
  ondismiss={() => { if (!asyncSubmit.busy) oncancel(); }}
  onenter={asyncSubmit.submit}
  enterDisabled={() => asyncSubmit.busy}
>
  {#snippet body()}
    <label>{label}
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value disabled={asyncSubmit.busy} aria-label="name-input" autofocus />
    </label>
    {#if asyncSubmit.error}<div class="dlg-error">{msgKey(asyncSubmit.error)}</div>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel} disabled={asyncSubmit.busy}>{m.common_cancel()}</button>
    <button class="primary" disabled={asyncSubmit.busy} onclick={asyncSubmit.submit}>
      {#if asyncSubmit.busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{m.common_ok()}{/if}
    </button>
  {/snippet}
</Modal>

<style>
  label { display: block; }
</style>
