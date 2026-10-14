<script lang="ts">
  import { errorMessage } from "../api/errors";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";
  import CodeEditor from "./CodeEditor.svelte";

  let {
    onsubmit,
    oncancel,
  }: {
    onsubmit: (
      fields: { field: string; dir: 1 | -1 }[],
      unique: boolean,
      name: string,
      sparse: boolean,
      ttlSeconds: number | null,
      partialFilter: string,
      collation: string,
    ) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let rows = $state<{ field: string; dir: 1 | -1 }[]>([{ field: "", dir: 1 }]);
  let unique = $state(false);
  let name = $state("");
  let advancedOpen = $state(false);
  let sparse = $state(false);
  let ttlEnabled = $state(false);
  let ttlSeconds = $state(0);
  let partialFilter = $state("");
  let collation = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  function addRow() {
    rows = [...rows, { field: "", dir: 1 }];
  }
  function removeRow(i: number) {
    rows = rows.filter((_, idx) => idx !== i);
  }

  async function submit() {
    busy = true;
    error = null;
    try {
      await onsubmit(
        $state.snapshot(rows),
        unique,
        name,
        sparse,
        ttlEnabled ? ttlSeconds : null,
        partialFilter,
        collation,
      );
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="form">
  {#each rows as row, i}
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={row.field} placeholder="field" aria-label={`field-${i}`} autofocus={i === 0} />
      <select bind:value={row.dir} aria-label={`dir-${i}`}>
        <option value={1}>asc</option>
        <option value={-1}>desc</option>
      </select>
      {#if rows.length > 1}
        <button class="rm" onclick={() => removeRow(i)} aria-label={`remove-${i}`}>×</button>
      {/if}
    </div>
  {/each}
  <button class="addfield" onclick={addRow}>{m.index_create_add_field()}</button>
  <label class="opt"><input type="checkbox" bind:checked={unique} aria-label="unique" /> {m.index_create_unique_label()}</label>
  <label class="opt">{m.index_create_name_label()}<input bind:value={name} aria-label="index-name" /></label>
  <button type="button" class="advanced-toggle" onclick={() => (advancedOpen = !advancedOpen)}>
    {advancedOpen ? m.index_create_advanced_hide() : m.index_create_advanced_show()}
  </button>
  {#if advancedOpen}
    <label class="opt"><input type="checkbox" bind:checked={sparse} aria-label="sparse" /> {m.index_create_sparse_label()}</label>
    <label class="opt ttl-row">
      <input type="checkbox" bind:checked={ttlEnabled} aria-label="ttl-enabled" /> {m.index_create_ttl_label()}
      <input type="number" min="0" bind:value={ttlSeconds} disabled={!ttlEnabled} aria-label="ttl-seconds" />
    </label>
    <label class="opt">{m.index_create_partial_label()}
      <div class="jsoneditor"><CodeEditor value={partialFilter} onChange={(v) => (partialFilter = v)} /></div>
    </label>
    <label class="opt">{m.index_create_collation_label()}
      <div class="jsoneditor"><CodeEditor value={collation} onChange={(v) => (collation = v)} /></div>
    </label>
  {/if}
  {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
  <footer>
    <button onclick={oncancel}>{m.common_cancel()}</button>
    <button class="primary" disabled={busy} onclick={submit}>{m.common_create()}</button>
  </footer>
</div>

<style>
  .form { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; margin: 0.5rem; font-size: 0.8125rem; background: var(--zebra); }
  .row { display: flex; gap: 0.375rem; margin-bottom: 0.375rem; }
  .row input { flex: 1; padding: 0.25rem 0.375rem; }
  .rm { border: none; background: none; cursor: pointer; color: var(--error); font-size: 1rem; }
  .addfield { border: 1px dashed var(--gray-c4); background: var(--panel); color: var(--fg); border-radius: var(--radius); padding: 0.1875rem 0.5rem; cursor: pointer; font-size: var(--fs); }
  .opt { display: block; margin-top: 0.5rem; }
  .opt input:not([type]) { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.25rem 0.375rem; }
  .ttl-row input[type="number"] { width: 6rem; margin-left: 0.5rem; padding: 0.1875rem 0.375rem; }
  .advanced-toggle { border: none; background: none; color: var(--link-strong); cursor: pointer; padding: 0; margin-top: 0.625rem; font-size: var(--fs); }
  .advanced-toggle:hover { text-decoration: underline; }
  .jsoneditor { height: 6rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: auto; margin-top: 0.25rem; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
