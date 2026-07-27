<script lang="ts">
  import Modal from "./Modal.svelte";
  import { createAsyncSubmit } from "./asyncSubmit.svelte";
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
  const asyncSubmit = createAsyncSubmit(() => onsubmit(db.trim(), coll.trim()));
</script>

<Modal
  title={m.new_db_title()}
  ondismiss={() => { if (!asyncSubmit.busy) oncancel(); }}
  onenter={asyncSubmit.submit}
  enterDisabled={() => asyncSubmit.busy}
>
  {#snippet body()}
    <p class="hint">{m.new_db_hint()}</p>
    <label>{m.new_db_name_label()}
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={db} disabled={asyncSubmit.busy} aria-label="db-input" autofocus />
    </label>
    <label>{m.new_db_first_collection_label()}<input bind:value={coll} disabled={asyncSubmit.busy} aria-label="coll-input" /></label>
    {#if asyncSubmit.error}<div class="dlg-error">{msgKey(asyncSubmit.error)}</div>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel} disabled={asyncSubmit.busy}>{m.common_cancel()}</button>
    <button class="primary" disabled={asyncSubmit.busy} onclick={asyncSubmit.submit}>{m.common_create()}</button>
  {/snippet}
</Modal>

<style>
  .hint { color: var(--th-fg); margin: 0 0 0.625rem; }
  label { display: block; margin-bottom: 0.625rem; }
</style>
