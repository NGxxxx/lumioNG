<script lang="ts">
  import { queryLibrary } from "../stores/queryLibrary.svelte";
  import { folderOptions } from "../domain/queryTree";
  import Modal from "./Modal.svelte";
  import { createAsyncSubmit } from "./asyncSubmit.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let { onsubmit, oncancel }: {
    onsubmit: (name: string, parentId: number | null) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  let parentId = $state<number | null>(null);

  const folders = $derived(folderOptions(queryLibrary.nodes, m.saved_queries_root_folder()));
  const valid = $derived(name.trim().length > 0);

  const asyncSubmit = createAsyncSubmit(() => onsubmit(name.trim(), parentId));
  function submit() {
    if (valid) asyncSubmit.submit();
  }
</script>

<Modal
  title={m.saved_queries_save_title()}
  stackBody
  fadeDisabled
  ondismiss={() => { if (!asyncSubmit.busy) oncancel(); }}
  onenter={submit}
  enterDisabled={() => asyncSubmit.busy || !valid}
>
  {#snippet body()}
    <label>{m.saved_queries_save_name_label()}
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={name} disabled={asyncSubmit.busy} aria-label="name-input" autofocus />
    </label>
    <label>{m.saved_queries_save_folder_label()}
      <select bind:value={parentId} disabled={asyncSubmit.busy} aria-label="folder-select">
        {#each folders as f (f.id)}
          <option value={f.id}>{f.label}</option>
        {/each}
      </select>
    </label>
    {#if asyncSubmit.error}<div class="dlg-error">{msgKey(asyncSubmit.error)}</div>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel} disabled={asyncSubmit.busy}>{m.common_cancel()}</button>
    <button class="primary" disabled={asyncSubmit.busy || !valid} onclick={submit}>
      {#if asyncSubmit.busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{m.common_ok()}{/if}
    </button>
  {/snippet}
</Modal>

<style>
  label { display: block; }
</style>
