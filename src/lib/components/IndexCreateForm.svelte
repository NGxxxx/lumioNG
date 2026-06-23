<script lang="ts">
  import { errorMessage } from "../api/errors";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    onsubmit,
    oncancel,
  }: {
    onsubmit: (
      fields: { field: string; dir: 1 | -1 }[],
      unique: boolean,
      name: string,
    ) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let rows = $state<{ field: string; dir: 1 | -1 }[]>([{ field: "", dir: 1 }]);
  let unique = $state(false);
  let name = $state("");
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
      await onsubmit($state.snapshot(rows), unique, name);
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
      <input bind:value={row.field} placeholder="field" aria-label={`field-${i}`} />
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
  {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
  <footer>
    <button onclick={oncancel}>{m.common_cancel()}</button>
    <button class="primary" disabled={busy} onclick={submit}>{m.common_create()}</button>
  </footer>
</div>

<style>
  .form { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin: 8px; font-size: 13px; background: #fafafa; }
  .row { display: flex; gap: 6px; margin-bottom: 6px; }
  .row input { flex: 1; padding: 4px 6px; }
  .rm { border: none; background: none; cursor: pointer; color: #b71c1c; font-size: 16px; }
  .addfield { border: 1px dashed #ccc; background: #fff; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
  .opt { display: block; margin-top: 8px; }
  .opt input:not([type]) { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 4px 6px; }
  .dlg-error { color: #b71c1c; margin-top: 8px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
