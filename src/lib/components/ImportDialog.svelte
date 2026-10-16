<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "#lib/stores/modalStack.js";
  import { formatFileSize } from "../domain/importPlan";
  import { createImportDialog } from "../stores/importDialog.svelte";
  import type { InsertMode } from "../api/documents";
  import TargetCollectionField from "./TargetCollectionField.svelte";
  import ImportProgressBar from "./ImportProgressBar.svelte";
  import ImportResultSummary from "./ImportResultSummary.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { sessionId, db, coll = null, existingCollections = [], onclose }: {
    sessionId: string;
    db: string;
    coll?: string | null;
    existingCollections?: string[];
    onclose: () => void;
  } = $props();

  const d = untrack(() => createImportDialog({ sessionId, db, coll, existingCollections }));

  const FORMAT_LABEL = { json: "JSON", jsonl: "JSONL", bson: "BSON", csv: "CSV", sql: "SQL dump" } as const;
  const INSERT_MODES: [InsertMode, () => string][] = [
    ["skipDuplicates", m.import_dialog_insert_mode_skip],
    ["upsertById", m.import_dialog_insert_mode_upsert],
    ["stopOnFirstError", m.import_dialog_insert_mode_stop],
  ];

  const title = $derived(
    d.format === "sql" ? m.sql_import_title({ db })
    : coll !== null ? m.import_dialog_title({ db, coll })
    : m.import_dialog_title_db({ db }),
  );
  const targetNotice = $derived(
    d.targetPlan?.kind === "existing" ? m.import_target_notice_existing({ coll: d.targetPlan.coll })
    : d.targetPlan?.kind === "new" ? m.import_target_notice_new({ coll: d.targetPlan.coll })
    : null,
  );
  const sqlTargetNotice = $derived(
    d.sqlTargetPlan?.kind === "existing" ? m.sql_import_target_existing({ coll: d.sqlTargetPlan.coll })
    : d.sqlTargetPlan?.kind === "new" ? m.sql_import_target_new({ n: d.sqlTargetPlan.collections.length, names: d.sqlTargetPlan.collections.join(", ") })
    : null,
  );
  const wide = $derived(d.format === "sql" || d.format === "csv");

  function primaryEnter() {
    if (d.view === "setup") d.start();
    else if (d.finished) onclose();
  }

  onMount(() => pushModal({
    onEscape: () => { if (!d.running) onclose(); },
    onEnter: primaryEnter,
    enterDisabled: () => (d.view === "setup" ? !d.canStart : !d.finished),
  }));
</script>

<div class="backdrop" use:portal role="presentation" use:backdropClose={() => { if (!d.running) onclose(); }}>
  <div class="modal" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <header><div class="title">{title}</div></header>
    <div class="body">
      <div class="file-row">
        <span class="label">{m.import_dialog_file_label()}</span>
        <span class="path" title={d.path}>{d.fileName || m.sql_import_no_file_chosen()}</span>
        {#if d.format}
          <span class="badge">{FORMAT_LABEL[d.format]}{d.size !== null ? ` · ${formatFileSize(d.size)}` : ""}</span>
        {/if}
        {#if d.view === "setup"}
          <button type="button" onclick={() => d.browse()}>{d.path ? m.import_dialog_change() : m.import_dialog_browse()}</button>
        {/if}
      </div>

      {#if d.view === "setup"}
        {#if !d.path}
          <p class="hint">{m.import_dialog_hint()}</p>
        {:else}
          {#if d.large}<div class="notice">{m.import_dialog_large_notice({ size: formatFileSize(d.size ?? 0) })}</div>{/if}
          {#if d.format === "sql"}<div class="notice">{m.sql_import_scope_notice()}</div>{/if}

          {#if d.format !== "sql"}
            <TargetCollectionField
              value={d.target}
              {existingCollections}
              onInput={(v) => (d.target = v)}
              errorKey={d.target ? d.targetError : null}
              notice={targetNotice}
            />
          {/if}

          <label class="option-row">
            <span class="label">{m.import_dialog_insert_mode_label()}</span>
            <select bind:value={d.insertMode} aria-label={m.import_dialog_insert_mode_label()}>
              {#each INSERT_MODES as [mode, label] (mode)}<option value={mode}>{label()}</option>{/each}
            </select>
          </label>

          {#if d.metadataBundle}
            <label class="metadata-toggle">
              <input type="checkbox" bind:checked={d.restoreMetadata} />
              {m.import_dialog_restore_metadata({ file: d.metadataFile })}
            </label>
          {/if}

          {#if d.sql}
            {@const v = d.sql}
            {#if v.phase === "loading"}
              <div class="status">{m.common_loading()}</div>
            {:else if v.tables.length === 0}
              <div class="status">{m.sql_import_no_tables()}</div>
            {:else}
              <TargetCollectionField
                value={v.targetColl}
                {existingCollections}
                onInput={(x) => v.setTargetColl(x)}
                errorKey={v.targetColl && d.sqlTargetError ? d.sqlTargetError : null}
                notice={sqlTargetNotice}
                placeholder={m.sql_import_target_placeholder()}
              />
              <div class="table-header">
                <label class="table-row select-all">
                  <input type="checkbox" checked={v.selected.size === v.tables.length} onchange={() => v.toggleAll()} />
                  <span class="tname">{m.sql_import_select_all()}</span>
                </label>
              </div>
              <ul class="tablelist">
                {#each v.tables as t (t.table)}
                  <li>
                    <label class="table-row">
                      <input type="checkbox" checked={v.selected.has(t.table)} onchange={() => v.toggle(t.table)} />
                      <span class="tname">{t.table}</span>
                      <span class="tmeta">{m.sql_import_row_count({ count: t.rowCount })} · {t.columns.length} cols</span>
                    </label>
                    {#if t.columns.length > 0}
                      <div class="tcolumns">{t.columns.map((c) => `${c.name}: ${c.inferredType}`).join(", ")}</div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if v.error}<div class="error">{v.error}</div>{/if}
          {:else if d.csv}
            {@const v = d.csv}
            <div class="csv-options">
              <div class="csv-radio-group" role="radiogroup" aria-label={m.csv_import_delimiter_label()}>
                <span class="label">{m.csv_import_delimiter_label()}</span>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "comma"} onchange={() => v.setDelimiter("comma")} /> {m.csv_import_delimiter_comma()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "semicolon"} onchange={() => v.setDelimiter("semicolon")} /> {m.csv_import_delimiter_semicolon()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "tab"} onchange={() => v.setDelimiter("tab")} /> {m.csv_import_delimiter_tab()}</label>
              </div>
              <label class="csv-checkbox"><input type="checkbox" checked={v.parseJsonLike} onchange={() => v.toggleParseJsonLike()} /> {m.csv_import_parse_json_like()}</label>
              <label class="csv-checkbox"><input type="checkbox" checked={v.inferScalars} onchange={() => v.toggleInferScalars()} /> {m.csv_import_infer_scalars()}</label>
            </div>
            {#if v.phase === "loading"}
              <div class="status">{m.common_loading()}</div>
            {:else if v.columns.length === 0}
              <div class="status">{m.csv_import_no_columns()}</div>
            {:else}
              <div class="csv-preview-wrap">
                <table class="csv-preview">
                  <thead><tr><th>{m.csv_import_preview_column()}</th><th>{m.csv_import_preview_type()}</th><th>{m.csv_import_preview_samples()}</th></tr></thead>
                  <tbody>
                    {#each v.columns as c (c.path)}
                      <tr><td class="tname">{c.path}</td><td>{c.inferredType}</td><td>{c.samples.join(", ")}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
            {#if v.error}<div class="error">{v.error}</div>{/if}
          {/if}
        {/if}
      {:else if d.sql}
        {@const v = d.sql}
        {#if v.phase === "running"}
          {#if v.progress}
            <div class="status">{v.progress.table}</div>
            <ImportProgressBar done={v.progress.done} total={v.progress.total} label={`${v.progress.done}/${v.progress.total}`} />
          {:else}
            <ImportProgressBar done={0} total={0} label={m.import_dialog_progress_unknown()} unknown={true} />
          {/if}
        {:else if v.phase === "done"}
          {#if v.cancelled}<div class="notice notice-cancelled">{m.sql_import_cancelled_notice()}</div>{/if}
          <div class="results">
            {#each v.results as r (r.table)}
              <div class="result-row">
                <span class="tname">{r.table}</span>
                <ImportResultSummary inserted={r.inserted} failed={r.failed} errors={r.errors} />
              </div>
            {/each}
          </div>
        {/if}
        {#if v.error}<div class="error">{v.error}</div>{/if}
      {:else if d.csv}
        {@const v = d.csv}
        {#if v.phase === "running"}
          {#if v.progress}
            <ImportProgressBar done={v.progress.done} total={v.progress.total} label={`${v.progress.done}/${v.progress.total}`} />
          {:else}
            <ImportProgressBar done={0} total={0} label={m.import_dialog_progress_unknown()} unknown={true} />
          {/if}
        {:else if v.phase === "done" && v.result}
          <ImportResultSummary inserted={v.result.inserted} failed={v.result.failed} errors={v.result.errors} />
        {/if}
        {#if v.error}<div class="error">{v.error}</div>{/if}
        {#if v.metadataError}<div class="notice">{m.import_dialog_metadata_error({ error: v.metadataError })}</div>{/if}
      {:else if d.job}
        {@const j = d.job}
        {#if j.total > 0}
          <ImportProgressBar done={j.done} total={j.total} label={m.import_dialog_progress({ done: j.done, total: j.total })} />
        {:else if j.running}
          <ImportProgressBar done={0} total={0} label={m.import_dialog_progress_unknown()} unknown={true} />
        {/if}
        {#if j.error}
          <div class="error">{m.import_dialog_error_title()}: {j.error}</div>
        {:else if j.result}
          <ImportResultSummary inserted={j.result.inserted} failed={j.result.failed} errors={j.result.errors} />
        {/if}
        {#if j.metadataError}<div class="notice">{m.import_dialog_metadata_error({ error: j.metadataError })}</div>{/if}
      {/if}
    </div>
    <footer>
      {#if d.view === "setup"}
        <button type="button" onclick={onclose}>{m.common_cancel()}</button>
        <button type="button" class="primary" disabled={!d.canStart} onclick={() => d.start()}>
          {d.sql ? m.sql_import_run({ count: d.sql.selected.size }) : m.import_dialog_run()}
        </button>
      {:else if d.running}
        {#if d.sql}<button type="button" onclick={() => d.sql?.cancel()}>{m.common_cancel()}</button>{/if}
        <!-- The import keeps running after the dialog closes (the status bar shows it). -->
        <button type="button" onclick={onclose}>{m.jobs_background()}</button>
      {:else if d.failed}
        <button type="button" onclick={() => d.back()}>{m.import_dialog_back()}</button>
        <button type="button" onclick={onclose}>{m.common_close()}</button>
      {:else}
        <button type="button" onclick={() => d.importAnother()}>{m.import_dialog_another()}</button>
        <button type="button" class="primary" onclick={onclose}>{m.common_close()}</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: var(--backdrop); display: flex; align-items: center; justify-content: center; z-index: 1000; overflow-y: auto; }
  .modal { background: var(--popover); border: 1px solid var(--c-surface1); width: 30rem; max-width: 94vw; border-radius: 0.75rem; overflow: hidden; box-shadow: var(--shadow-lg); }
  .modal.wide { width: 34rem; }
  .modal { max-height: 88vh; display: flex; flex-direction: column; }
  header { padding: 0.625rem 0.875rem; border-bottom: 1px solid var(--bg); flex: none; }
  header .title { font-weight: 600; }
  .body { padding: 0.875rem; font-size: 0.8125rem; overflow: auto; min-height: 0; }
  .file-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .file-row button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; flex: none; }
  .file-row button:hover { background: var(--bg); }
  .label { color: var(--gray-77); flex: none; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: var(--fs); margin-bottom: 0.75rem; }
  .notice-cancelled { background: var(--warn-bg); color: var(--warn-fg); }
  .badge { flex: none; font-size: 0.6875rem; color: var(--muted); padding: 0.0625rem 0.375rem; border: 1px solid var(--border); border-radius: var(--radius-sm); white-space: nowrap; }
  .hint { margin: 0.25rem 0 0; color: var(--muted); font-size: var(--fs); }
  .option-row { display: flex; align-items: center; gap: 0.625rem; font-size: var(--fs); margin: 0.625rem 0 0.75rem; }
  .option-row select { height: 1.625rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs); padding: 0 0.375rem; }
  .metadata-toggle { display: flex; align-items: center; gap: 0.375rem; cursor: pointer; font-size: var(--fs); margin-bottom: 0.75rem; }
  .status { color: var(--gray-77); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; border-radius: var(--radius); }
  .result-row { display: flex; flex-direction: column; gap: 0.125rem; margin-bottom: 0.5rem; }

  /* ── SQL table picker ── */
  .table-header { border-bottom: 1px solid var(--border); margin-bottom: 0.25rem; }
  .tablelist { list-style: none; margin: 0; padding: 0; max-height: 16rem; overflow: auto; }
  .tablelist li { border-bottom: 1px solid var(--border); padding: 0.25rem 0; }
  .table-row { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
  .select-all { padding-bottom: 0.25rem; font-weight: 600; }
  .tname { font-family: var(--mono); }
  .tmeta { margin-left: auto; color: var(--gray-77); font-size: 0.6875rem; }
  .tcolumns { padding-left: 1.5rem; color: var(--gray-77); font-family: var(--mono); font-size: 0.6875rem; word-break: break-word; }
  .csv-options { display: flex; flex-direction: column; gap: 0.375rem; margin-bottom: 0.75rem; font-size: var(--fs); }
  .csv-radio-group { display: flex; align-items: center; gap: 0.625rem; }
  .csv-radio-group .label { color: var(--gray-77); }
  .csv-checkbox { display: flex; align-items: center; gap: 0.375rem; cursor: pointer; }
  .csv-preview-wrap { max-height: 16rem; overflow: auto; }
  .csv-preview { width: 100%; border-collapse: collapse; font-size: var(--fs); }
  .csv-preview th, .csv-preview td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .csv-preview td.tname { font-family: var(--mono); }

  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); flex: none; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
  footer .primary:disabled { opacity: 0.45; color: var(--on-accent); }
</style>
