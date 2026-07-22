<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { errorMessage } from "../api/errors";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "$lib/stores/modalStack";
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
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit() {
    busy = true;
    error = null;
    try {
      await onsubmit(value.trim());
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  onMount(() => pushModal({
    onEscape: () => { if (!busy) oncancel(); },
    onEnter: submit,
    enterDisabled: () => busy,
  }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  use:backdropClose={() => { if (!busy) oncancel(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      <label>{label}
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value disabled={busy} aria-label="name-input" autofocus />
      </label>
      {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel} disabled={busy}>{m.common_cancel()}</button>
      <button class="primary" disabled={busy} onclick={submit}>
        {#if busy}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{m.common_ok()}{/if}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  label { display: block; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
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
