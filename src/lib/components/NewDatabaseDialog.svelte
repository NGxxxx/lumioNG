<script lang="ts">
  import { onMount } from "svelte";
  import { errorMessage } from "../api/errors";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "$lib/stores/modalStack";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    onsubmit,
    oncancel,
  }: {
    onsubmit: (db: string, coll: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let db = $state("");
  let coll = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit() {
    busy = true;
    error = null;
    try {
      await onsubmit(db.trim(), coll.trim());
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
  <div class="modal" role="dialog" aria-modal="true" aria-label="New database">
    <header>New database</header>
    <div class="body">
      <p class="hint">{m.new_db_hint()}</p>
      <label>{m.new_db_name_label()}
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={db} disabled={busy} aria-label="db-input" autofocus />
      </label>
      <label>{m.new_db_first_collection_label()}<input bind:value={coll} disabled={busy} aria-label="coll-input" /></label>
      {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel} disabled={busy}>{m.common_cancel()}</button>
      <button class="primary" disabled={busy} onclick={submit}>{m.common_create()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .hint { color: var(--th-fg); margin: 0 0 0.625rem; }
  label { display: block; margin-bottom: 0.625rem; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--panel); border: none; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
