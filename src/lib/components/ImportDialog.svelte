<script lang="ts">
  import { portal } from "../actions/portal";
  import { openDialog, importFileSize } from "../api/files";
  import { describeSqlImportTargets, isLargeImportFile, formatFileSize } from "../domain/importPlan";
  import { createImportJob } from "../stores/importJob.svelte";
  import { createSqlImport } from "../stores/sqlImport.svelte";
  import { createCsvImport } from "../stores/csvImport.svelte";
  import type { CsvDelimiter } from "../api/csv";
  import type { InsertMode } from "../api/documents";
  import * as m from "$lib/paraglide/messages";

  // `coll === null` (or picking a .sql file) switches this dialog into the multi-table SQL flow;
  // picking a .csv file (only offered when `coll` is set — CSV always targets one collection)
  // switches it into the single-collection CSV flow.
  let { sessionId, db, coll = null, onclose }: {
    sessionId: string;
    db: string;
    coll?: string | null;
    onclose: () => void;
  } = $props();

  let path = $state("");
  let stage = $state<"setup" | "working">("setup");
  let insertMode = $state<InsertMode>("skipDuplicates");
  let fileSizeChecked = $state(false);
  let pendingLargeFile = $state(false);
  let pendingSize = $state(0);
  let job = $state<ReturnType<typeof createImportJob> | null>(null);
  let sql = $state<ReturnType<typeof createSqlImport> | null>(null);
  let csv = $state<ReturnType<typeof createCsvImport> | null>(null);

  const isSql = $derived(coll === null || path.toLowerCase().endsWith(".sql"));
  const isCsv = $derived(coll !== null && path.toLowerCase().endsWith(".csv"));
  const fileName = $derived(path.replace(/^.*[\\/]/, ""));
  const percent = $derived(job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0);
  const canClose = $derived(
    stage === "setup" || (isSql ? sql!.phase !== "running" : isCsv ? csv!.phase !== "running" : !job!.running),
  );
  const title = $derived(isSql ? m.sql_import_title({ db }) : m.import_dialog_title({ db, coll: coll ?? "" }));

  async function browse() {
    const filters = coll === null
      ? [{ name: "SQL", extensions: ["sql"] }]
      : [{ name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] }];
    const p = await openDialog(filters);
    if (p) {
      path = p;
      fileSizeChecked = false;
    }
  }

  async function startRun() {
    if (!path) return;
    if (!fileSizeChecked) {
      const checkedPath = path;
      const size = await importFileSize(checkedPath);
      if (path !== checkedPath) return; // user picked a different file while the size check was in flight
      if (isLargeImportFile(size)) {
        pendingSize = size;
        pendingLargeFile = true;
        return;
      }
      fileSizeChecked = true;
    }
    stage = "working";
    if (isSql) {
      sql = createSqlImport(sessionId, db, path, coll, insertMode);
      sql.loadPreview();
    } else if (isCsv) {
      csv = createCsvImport(sessionId, db, coll!, path, insertMode);
      csv.loadPreview();
    } else {
      job = createImportJob({ sessionId, db, coll: coll!, path, insertMode });
      job.run();
    }
  }

  function confirmLargeFile() {
    fileSizeChecked = true;
    pendingLargeFile = false;
    startRun();
  }

  function cancelLargeFile() {
    pendingLargeFile = false;
  }

  let showErrors = $state(false);
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && canClose) onclose(); }} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget && canClose) onclose(); }}
>
  <div class="modal" class:modal-sql={stage === "working" && isSql} role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      {#if stage === "setup"}
        <div class="file-row">
          <span class="label">{m.import_dialog_file_label()}</span>
          <span class="path">{fileName || m.sql_import_no_file_chosen()}</span>
          <button type="button" onclick={browse}>{m.import_dialog_browse()}</button>
        </div>
        {#if coll !== null}
          <div class="file-row"><span class="label">{m.export_wizard_col_collection()}</span><span class="path">{coll}</span></div>
        {/if}
        {#if isSql}<div class="notice">{m.sql_import_scope_notice()}</div>{/if}
        <div class="insert-mode-group">
          <span class="label">{m.import_dialog_insert_mode_label()}</span>
          <label><input type="radio" name="insert-mode" checked={insertMode === "skipDuplicates"} onchange={() => (insertMode = "skipDuplicates")} /> {m.import_dialog_insert_mode_skip()}</label>
          <label><input type="radio" name="insert-mode" checked={insertMode === "upsertById"} onchange={() => (insertMode = "upsertById")} /> {m.import_dialog_insert_mode_upsert()}</label>
          <label><input type="radio" name="insert-mode" checked={insertMode === "stopOnFirstError"} onchange={() => (insertMode = "stopOnFirstError")} /> {m.import_dialog_insert_mode_stop()}</label>
        </div>
        {#if pendingLargeFile}
          <div class="notice">{m.import_dialog_large_file_notice({ size: formatFileSize(pendingSize) })}</div>
        {/if}
      {:else}
        <div class="file-row"><span class="label">{m.import_dialog_file_label()}</span><span class="path">{fileName}</span></div>

        {#if isSql}
          {@const v = sql!}
          <div class="notice">{m.sql_import_scope_notice()}</div>
          {#if v.phase === "loading"}
            <div class="status">{m.common_loading()}</div>
          {:else if v.phase === "selecting" || v.phase === "running"}
            {#if v.tables.length === 0}
              <div class="status">{m.sql_import_no_tables()}</div>
            {:else}
              {#if v.selected.size > 0}
                {@const target = describeSqlImportTargets(v.tables.length, [...v.selected], coll)}
                <div class="notice">
                  {#if target.kind === "existing"}
                    {m.sql_import_target_existing({ coll: target.coll })}
                  {:else}
                    {m.sql_import_target_new({ n: target.collections.length, names: target.collections.join(", ") })}
                  {/if}
                </div>
              {/if}
              <div class="table-header">
                <label class="table-row select-all">
                  <input type="checkbox" checked={v.selected.size === v.tables.length} onchange={() => v.toggleAll()} disabled={v.phase === "running"} />
                  <span class="tname">{m.sql_import_select_all()}</span>
                </label>
              </div>
              <ul class="tablelist">
                {#each v.tables as t (t.table)}
                  <li>
                    <label class="table-row">
                      <input type="checkbox" checked={v.selected.has(t.table)} onchange={() => v.toggle(t.table)} disabled={v.phase === "running"} />
                      <span class="tname">{t.table}</span>
                      <span class="tmeta">{m.sql_import_row_count({ count: t.rowCount })} · {t.columns.length} cols</span>
                    </label>
                    {#if v.phase === "running" && v.progress?.table === t.table}
                      <div class="progress">
                        <div class="bar"><div class="fill" style="width:{t.rowCount > 0 ? Math.round((v.progress.done / t.rowCount) * 100) : 100}%"></div></div>
                        <span>{v.progress.done}/{v.progress.total}</span>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if v.error}<div class="error">{v.error}</div>{/if}
          {:else if v.phase === "done"}
            <div class="results">
              {#each v.results as r (r.table)}
                <div class="io-ok">{r.table}: {m.namespace_panel_import_done({ inserted: r.inserted, failed: r.failed })}</div>
                {#if r.errors.length > 0}
                  <ul class="errlist">{#each r.errors as e}<li>{e}</li>{/each}</ul>
                {/if}
              {/each}
            </div>
          {/if}
        {:else if isCsv}
          {@const v = csv!}
          {#if v.phase === "loading"}
            <div class="status">{m.common_loading()}</div>
          {:else if v.phase === "config" || v.phase === "running"}
            <div class="csv-options">
              <label class="csv-radio-group">
                <span class="label">{m.csv_import_delimiter_label()}</span>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "comma"} onchange={() => v.setDelimiter("comma")} disabled={v.phase === "running"} /> {m.csv_import_delimiter_comma()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "semicolon"} onchange={() => v.setDelimiter("semicolon")} disabled={v.phase === "running"} /> {m.csv_import_delimiter_semicolon()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "tab"} onchange={() => v.setDelimiter("tab")} disabled={v.phase === "running"} /> {m.csv_import_delimiter_tab()}</label>
              </label>
              <label class="csv-checkbox"><input type="checkbox" checked={v.parseJsonLike} onchange={() => v.toggleParseJsonLike()} disabled={v.phase === "running"} /> {m.csv_import_parse_json_like()}</label>
              <label class="csv-checkbox"><input type="checkbox" checked={v.inferScalars} onchange={() => v.toggleInferScalars()} disabled={v.phase === "running"} /> {m.csv_import_infer_scalars()}</label>
            </div>
            {#if v.columns.length === 0}
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
            {#if v.phase === "running"}
              <div class="progress">
                <div class="bar"><div class="fill" style="width:{v.progress && v.progress.total > 0 ? Math.round((v.progress.done / v.progress.total) * 100) : 0}%"></div></div>
                <span>{v.progress ? `${v.progress.done}/${v.progress.total}` : ""}</span>
              </div>
            {/if}
            {#if v.error}<div class="error">{v.error}</div>{/if}
          {:else if v.phase === "done"}
            {@const r = v.result!}
            <div class="io-ok">{m.namespace_panel_import_done({ inserted: r.inserted, failed: r.failed })}</div>
            {#if r.errors.length > 0}
              <ul class="errlist">{#each r.errors as e}<li>{e}</li>{/each}</ul>
            {/if}
          {/if}
        {:else}
          {@const j = job!}
          {#if j.total > 0}
            <div class="progress">
              <div class="bar"><div class="fill" style="width:{percent}%"></div></div>
              <span>{m.import_dialog_progress({ done: j.done, total: j.total })}</span>
            </div>
          {:else if j.running}
            <div class="progress-unknown">{m.import_dialog_progress_unknown()}</div>
          {/if}

          {#if j.error}
            <div class="error">{m.import_dialog_error_title()}: {j.error}</div>
          {:else if j.result}
            {@const r = j.result}
            <div class="io-ok">{m.namespace_panel_import_done({ inserted: r.inserted, failed: r.failed })}</div>
            {#if r.errors.length > 0}
              <button type="button" class="link" onclick={() => (showErrors = !showErrors)}>
                {m.import_dialog_view_errors({ count: r.errors.length })}
              </button>
              {#if showErrors}
                <ul class="errlist">
                  {#each r.errors as e}<li>{e}</li>{/each}
                </ul>
              {/if}
            {/if}
          {/if}
        {/if}
      {/if}
    </div>
    <footer>
      {#if stage === "setup"}
        {#if pendingLargeFile}
          <button type="button" onclick={cancelLargeFile}>{m.common_cancel()}</button>
          <button type="button" class="primary" onclick={confirmLargeFile}>{m.import_dialog_large_file_continue()}</button>
        {:else}
          <button type="button" onclick={onclose}>{m.common_cancel()}</button>
          <button type="button" class="primary" disabled={!path} onclick={startRun}>{m.import_dialog_run()}</button>
        {/if}
      {:else if isSql && sql!.phase === "selecting"}
        <button type="button" onclick={onclose}>{m.common_cancel()}</button>
        <button type="button" class="primary" disabled={sql!.selected.size === 0} onclick={() => sql!.run()}>{m.sql_import_run({ count: sql!.selected.size })}</button>
      {:else if isCsv && csv!.phase === "config"}
        <button type="button" onclick={onclose}>{m.common_cancel()}</button>
        <button type="button" class="primary" disabled={csv!.columns.length === 0} onclick={() => csv!.run()}>{m.import_dialog_run()}</button>
      {:else}
        <button type="button" class="primary" onclick={onclose} disabled={!canClose}>{m.common_close()}</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .3); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--panel); width: 30rem; max-width: 94vw; border-radius: 0.375rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, .25); }
  .modal-sql { width: 32rem; max-height: 85vh; display: flex; flex-direction: column; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); flex: none; }
  .body { padding: 0.875rem; font-size: 0.8125rem; overflow: auto; min-height: 0; }
  .file-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .file-row button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; flex: none; }
  .file-row button:hover { background: var(--bg); }
  .label { color: var(--gray-77); flex: none; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: 0.1875rem; font-size: 0.75rem; margin-bottom: 0.75rem; }
  .insert-mode-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; font-size: 0.75rem; margin-bottom: 0.75rem; }
  .insert-mode-group .label { color: var(--gray-77); }
  .insert-mode-group label { display: flex; align-items: center; gap: 0.25rem; cursor: pointer; }
  .status { color: var(--gray-77); }
  .progress { display: flex; align-items: center; gap: 0.5rem; }
  .bar { flex: 1; height: 0.5rem; background: var(--bg); border-radius: 0.25rem; overflow: hidden; }
  .fill { height: 100%; background: var(--progress); transition: width .2s; }
  .progress-unknown { color: var(--gray-77); }
  .io-ok { background: var(--ok-bg); color: var(--ok-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; border-radius: 0.1875rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; border-radius: 0.1875rem; }
  .link { border: none; background: none; color: var(--link-strong); cursor: pointer; padding: 0; font-size: 0.75rem; margin-top: 0.5rem; }
  .link:hover { text-decoration: underline; }
  .errlist { margin: 0.375rem 0 0; padding-left: 1.125rem; max-height: 8rem; overflow: auto; font-size: 0.75rem; color: var(--error); }

  /* ── SQL table picker ── */
  .table-header { border-bottom: 1px solid var(--border); margin-bottom: 0.25rem; }
  .tablelist { list-style: none; margin: 0; padding: 0; max-height: 16rem; overflow: auto; }
  .tablelist li { border-bottom: 1px solid var(--border); padding: 0.25rem 0; }
  .table-row { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
  .select-all { padding-bottom: 0.25rem; font-weight: 600; }
  .tname { font-family: ui-monospace, monospace; }
  .tmeta { margin-left: auto; color: var(--gray-77); font-size: 0.6875rem; }
  .csv-options { display: flex; flex-direction: column; gap: 0.375rem; margin-bottom: 0.75rem; font-size: 0.75rem; }
  .csv-radio-group { display: flex; align-items: center; gap: 0.625rem; }
  .csv-radio-group .label { color: var(--gray-77); }
  .csv-checkbox { display: flex; align-items: center; gap: 0.375rem; cursor: pointer; }
  .csv-preview-wrap { max-height: 16rem; overflow: auto; }
  .csv-preview { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  .csv-preview th, .csv-preview td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .csv-preview td.tname { font-family: ui-monospace, monospace; }

  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); flex: none; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--panel); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
