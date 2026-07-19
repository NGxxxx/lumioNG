<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { errorMessage } from "../api/errors";
  import { queryLibrary } from "../stores/queryLibrary.svelte";
  import { folderOptions } from "../domain/queryTree";
  import { pushModal } from "$lib/stores/modalStack";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let { onsubmit, oncancel }: {
    onsubmit: (name: string, parentId: number | null) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  let parentId = $state<number | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const folders = $derived(folderOptions(queryLibrary.nodes, m.saved_queries_root_folder()));
  const valid = $derived(name.trim().length > 0);

  async function submit() {
    if (!valid) return;
    busy = true;
    error = null;
    try {
      await onsubmit(name.trim(), parentId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  onMount(() => pushModal({
    onEscape: () => { if (!busy) oncancel(); },
    onEnter: submit,
    enterDisabled: () => busy || !valid,
  }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && !busy) oncancel();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.saved_queries_save_title()}>
    <header>{m.saved_queries_save_title()}</header>
    <div class="body">
      <label>{m.saved_queries_save_name_label()}
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={name} disabled={busy} aria-label="name-input" autofocus />
      </label>
      <label>{m.saved_queries_save_folder_label()}
        <select bind:value={parentId} disabled={busy} aria-label="folder-select">
          {#each folders as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </label>
      {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel} disabled={busy}>{m.common_cancel()}</button>
      <button class="primary" disabled={busy || !valid} onclick={submit}>
        {#if busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{m.common_ok()}{/if}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; display: flex; flex-direction: column; gap: 0.625rem; }
  label { display: block; }
  .body input, .body select { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  .dlg-error { color: var(--error); }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { display: inline-flex; align-items: center; gap: 0.375rem; height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { opacity: 0.6; cursor: default; }
  footer .primary { background: var(--run); color: var(--panel); border: none; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
  .dlg-spinner {
    width: 0.75rem; height: 0.75rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: dlg-spin 0.7s linear infinite;
  }
  @keyframes dlg-spin { to { transform: rotate(360deg); } }
</style>
