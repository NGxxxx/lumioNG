<!-- src/lib/components/ImportBatchPanel.svelte — ImportDialog's body for several files / a folder:
     one row per file (target collection editable before the run), shared options, live status. -->
<script lang="ts">
  import type { createImportBatch } from "../stores/importBatch.svelte";
  import type { InsertMode } from "../api/documents";
  import ImportProgressBar from "./ImportProgressBar.svelte";
  import { msgKey } from "../msgkey";
  import { formatCount } from "../domain/stats";
  import * as m from "#lib/paraglide/messages.js";

  let { batch: b, insertModes }: {
    batch: ReturnType<typeof createImportBatch>;
    insertModes: [InsertMode, () => string][];
  } = $props();

  const editable = $derived(!b.running && !b.finished);
  const hasCsv = $derived(b.rows.some((r) => !r.skip && r.format === "csv"));
</script>

{#if b.importable === 0}
  <div class="notice">{m.import_batch_none()}</div>
{/if}

<div class="table-wrap">
<table class="files">
  <thead>
    <tr><th>{m.import_batch_col_file()}</th><th>{m.import_batch_col_target()}</th><th>{m.import_batch_col_status()}</th></tr>
  </thead>
  <tbody>
    {#each b.rows as r, i (r.path)}
      {@const err = b.errors[i]}
      <tr class:skipped={r.skip !== null}>
        <td class="fname" title={r.path}>{r.fileName}</td>
        <td>
          {#if r.skip}
            <span class="muted">{msgKey(`import_batch_skip_${r.skip}`)}</span>
          {:else if editable}
            <input class="coll" class:invalid={err} value={r.coll} oninput={(e) => b.setColl(i, e.currentTarget.value)} aria-label={m.import_batch_col_target()} title={err ? msgKey(err) : undefined} />
          {:else}
            <span class="mono">{r.coll}</span>
          {/if}
        </td>
        <td class="status {r.status}" title={r.error ?? undefined}>
          {msgKey(`import_batch_status_${r.status}`)}{#if r.status === "done" || (r.status === "failed" && r.inserted > 0)}{" · "}{m.import_batch_inserted({ count: formatCount(r.inserted) })}{/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
</div>

{#if editable}
  {#each b.rows as r, i (r.path)}{#if b.errors[i]}<div class="error">{r.fileName}: {msgKey(b.errors[i])}</div>{/if}{/each}
  <label class="option-row">
    <span class="label">{m.import_dialog_insert_mode_label()}</span>
    <select bind:value={b.insertMode} aria-label={m.import_dialog_insert_mode_label()}>
      {#each insertModes as [mode, label] (mode)}<option value={mode}>{label()}</option>{/each}
    </select>
  </label>
  <label class="check"><input type="checkbox" bind:checked={b.restoreMetadata} /> {m.import_batch_restore_metadata()}</label>
  {#if hasCsv}<p class="hint">{m.import_batch_csv_note()}</p>{/if}
{:else}
  <div class="progress">
    <ImportProgressBar done={b.completed} total={b.importable} label={m.import_batch_progress({ done: b.completed, total: b.importable })} />
    {#if b.current && b.current.total > 0}
      <ImportProgressBar done={b.current.done} total={b.current.total} label={m.import_dialog_progress({ done: b.current.done, total: b.current.total })} />
    {/if}
  </div>
  {#each b.rows as r (r.path)}{#if r.error}<div class="error">{r.fileName}: {r.error}</div>{/if}{/each}
{/if}

<style>
  .table-wrap { max-height: 18rem; overflow: auto; margin-bottom: 0.625rem; border-bottom: 1px solid var(--border); }
  .files { width: 100%; border-collapse: collapse; font-size: var(--fs); }
  .files thead th { position: sticky; top: 0; background: var(--popover); z-index: 1; }
  .files tbody tr:last-child td { border-bottom: none; }
  .files th, .files td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .files th { color: var(--gray-77); font-weight: 500; }
  .fname { font-family: var(--mono); max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skipped td { color: var(--muted); }
  .coll { width: 100%; height: 1.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-family: var(--mono); font-size: var(--fs); padding: 0 0.375rem; box-sizing: border-box; }
  .coll.invalid { border-color: var(--error); }
  .mono { font-family: var(--mono); }
  .muted { color: var(--muted); }
  .status { white-space: nowrap; color: var(--gray-77); }
  .status.done { color: var(--ok-fg); }
  .status.failed { color: var(--error); }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: var(--fs); margin-bottom: 0.75rem; }
  .option-row { display: flex; align-items: center; gap: 0.625rem; font-size: var(--fs); margin: 0.625rem 0 0.5rem; }
  .option-row .label { color: var(--gray-77); }
  .option-row select { height: 1.625rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs); padding: 0 0.375rem; }
  .check { display: flex; align-items: center; gap: 0.375rem; cursor: pointer; font-size: var(--fs); }
  .hint { margin: 0.375rem 0 0; color: var(--muted); font-size: var(--fs); }
  .progress { display: flex; flex-direction: column; gap: 0.5rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.375rem; border-radius: var(--radius); }
</style>
