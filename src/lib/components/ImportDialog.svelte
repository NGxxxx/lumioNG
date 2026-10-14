<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "#lib/stores/modalStack.js";
  import { openDialog, importFileSize, readTextFileIfExists } from "../api/files";
  import { metadataPathFor } from "../domain/collectionMetadata";
  import { describeSqlImportTargets, describeImportTarget, isLargeImportFile, formatFileSize } from "../domain/importPlan";
  import { validateCollectionName } from "../domain/namespaces";
  import { createImportJob } from "../stores/importJob.svelte";
  import { createSqlImport } from "../stores/sqlImport.svelte";
  import { createCsvImport } from "../stores/csvImport.svelte";
  import type { InsertMode } from "../api/documents";
  import TargetCollectionField from "./TargetCollectionField.svelte";
  import ImportProgressBar from "./ImportProgressBar.svelte";
  import ImportResultSummary from "./ImportResultSummary.svelte";
  import * as m from "#lib/paraglide/messages.js";

  // File extension alone decides the flow (.sql -> multi-table SQL, .csv -> single-collection CSV).
  // Single-target formats (JSON/JSONL/BSON/CSV) collect their target collection on the Source step,
  // right before their store is constructed — importJob/csvImport bake `coll` into a closure used by
  // `run()`, so it can't be edited later without losing already-chosen state (delimiter, toggles).
  // SQL's target lives on the Configure step instead: sqlImport's `targetColl` is a live $state field
  // safe to edit any time after the table-picker preview loads. See the design doc's "Why
  // target-field placement differs by format" for the full reasoning.
  let { sessionId, db, coll = null, existingCollections = [], onclose }: {
    sessionId: string;
    db: string;
    coll?: string | null;
    existingCollections?: string[];
    onclose: () => void;
  } = $props();

  let path = $state("");
  let targetColl = $state(untrack(() => coll ?? ""));
  let stage = $state<"source" | "configure" | "run">("source");
  let insertMode = $state<InsertMode>("skipDuplicates");
  let fileSizeChecked = $state(false);
  let pendingLargeFile = $state(false);
  let pendingSize = $state(0);
  let job = $state<ReturnType<typeof createImportJob> | null>(null);
  let sql = $state<ReturnType<typeof createSqlImport> | null>(null);
  let csv = $state<ReturnType<typeof createCsvImport> | null>(null);
  // Companion `.metadata.json` sidecar next to the chosen file, if any (JSON/JSONL/BSON/CSV only —
  // a multi-table SQL dump has no single collection to apply one bundle's indexes/validator to).
  let metadataBundle = $state<string | null>(null);
  let restoreMetadata = $state(true);
  /** What `sql`/`csv` were last built for — lets a Back-then-Next round trip (no file/target change)
   *  reuse the live store instead of reconstructing it and losing table selection / delimiter /
   *  toggles. Only `targetColl` needs tracking for CSV (its `coll` is a constructor argument); SQL's
   *  target is a live field on the store itself, safe regardless. */
  let builtForPath = $state<string | null>(null);
  let builtForTargetColl = $state<string | null>(null);

  const isSql = $derived(path.toLowerCase().endsWith(".sql"));
  const isCsv = $derived(path.toLowerCase().endsWith(".csv"));
  const showTarget = $derived(!isSql && !!path);
  const targetErrorMsg = $derived(showTarget ? validateCollectionName(targetColl.trim()) : null);
  /** SQL's own target field (see sqlImport.svelte.ts) is only validated when non-blank — blank
   *  means "one new collection per table", which needs no validation. */
  const sqlTargetError = $derived(
    sql && sql.targetColl.trim() ? validateCollectionName(sql.targetColl.trim()) : null,
  );
  const fileName = $derived(path.replace(/^.*[\\/]/, ""));
  const canClose = $derived(
    stage !== "run" || (isSql ? sql!.phase !== "running" : isCsv ? csv!.phase !== "running" : !job!.running),
  );
  const title = $derived(
    isSql ? m.sql_import_title({ db })
    : coll !== null ? m.import_dialog_title({ db, coll })
    : m.import_dialog_title_db({ db }),
  );
  const targetNotice = $derived.by(() => {
    if (!showTarget) return null;
    const plan = describeImportTarget(targetColl, existingCollections);
    return plan.kind === "existing" ? m.import_target_notice_existing({ coll: plan.coll })
      : plan.kind === "new" ? m.import_target_notice_new({ coll: plan.coll })
      : null;
  });
  const stepNum = $derived(stage === "source" ? 1 : stage === "configure" ? 2 : 3);
  const stepLabel = $derived(
    stage === "source" ? m.import_wizard_step_source()
    : stage === "configure" ? m.import_wizard_step_configure()
    : m.import_wizard_step_run(),
  );
  const formatLabel = $derived(
    !path ? ""
    : isSql ? "SQL dump"
    : isCsv ? "CSV"
    : path.toLowerCase().endsWith(".bson") ? "BSON"
    : path.toLowerCase().endsWith(".jsonl") ? "JSONL"
    : "JSON",
  );

  function sqlTargetNotice(v: NonNullable<typeof sql>): string {
    const target = describeSqlImportTargets([...v.selected], v.targetColl);
    return target.kind === "existing"
      ? m.sql_import_target_existing({ coll: target.coll })
      : m.sql_import_target_new({ n: target.collections.length, names: target.collections.join(", ") });
  }

  async function checkMetadata(p: string) {
    metadataBundle = null;
    if (p.toLowerCase().endsWith(".sql")) return;
    const text = await readTextFileIfExists(metadataPathFor(p));
    if (path === p) metadataBundle = text; // ignore a stale check if the user picked another file meanwhile
  }

  async function browse() {
    const filters = [{ name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] }];
    const p = await openDialog(filters);
    if (p) {
      path = p;
      fileSizeChecked = false;
      void checkMetadata(p);
    }
  }

  async function goConfigure() {
    if (!path) return;
    if (showTarget && targetErrorMsg) return;
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
    stage = "configure";
    const target = targetColl.trim();
    if (path === builtForPath && (!isCsv || target === builtForTargetColl)) return; // returning to an unchanged file — keep the live store
    builtForPath = path;
    builtForTargetColl = target;
    if (isSql) {
      sql = createSqlImport(sessionId, db, path, coll, insertMode);
      sql.loadPreview();
    } else if (isCsv) {
      csv = createCsvImport(sessionId, db, target, path, insertMode);
      csv.loadPreview();
    }
  }

  function confirmLargeFile() {
    fileSizeChecked = true;
    pendingLargeFile = false;
    goConfigure();
  }

  function cancelLargeFile() {
    pendingLargeFile = false;
  }

  function goBack() {
    stage = "source";
  }

  /** Run-stage retry path for SQL/CSV: after a failed commit, the store already reverts its own
   *  `phase` back to "selecting"/"config", but `stage` stays on "run". This routes back to
   *  Configure directly (not via goBack/"source") so the existing sql/csv store — and the user's
   *  table selection / target / delimiter / toggles — survives instead of being reconstructed. */
  function goBackToConfigure() {
    stage = "configure";
  }

  function goRun() {
    if (isSql) {
      if (sql!.selected.size === 0 || sqlTargetError) return;
      sql!.setInsertMode(insertMode);
      sql!.run();
    } else if (isCsv) {
      if (csv!.columns.length === 0 || csv!.phase === "loading") return;
      csv!.setInsertMode(insertMode);
      csv!.run(restoreMetadata ? metadataBundle : null);
    } else {
      job = createImportJob({
        sessionId, db, coll: targetColl.trim(), path, insertMode,
        restoreMetadataBundle: restoreMetadata ? metadataBundle : null,
      });
      job.run();
    }
    stage = "run";
  }

  function primaryEnter() {
    if (stage === "source") {
      if (pendingLargeFile) confirmLargeFile();
      else if (path && !(showTarget && targetErrorMsg)) goConfigure();
      return;
    }
    if (stage === "configure") {
      if (isSql && (sql!.selected.size === 0 || sqlTargetError)) return;
      if (isCsv && (csv!.columns.length === 0 || csv!.phase === "loading")) return;
      goRun();
      return;
    }
    // stage === "run"
    if (isSql && sql!.phase === "running") return;
    if (isCsv && csv!.phase === "running") return;
    if (!isSql && !isCsv && job!.running) return;
    if (canClose) onclose();
  }

  function primaryEnterDisabled(): boolean {
    if (stage === "source") return pendingLargeFile ? false : (!path || (showTarget && !!targetErrorMsg));
    if (stage === "configure") {
      if (isSql) return sql!.selected.size === 0 || !!sqlTargetError;
      if (isCsv) return csv!.columns.length === 0 || csv!.phase === "loading";
      return false;
    }
    return !canClose; // run stage
  }

  onMount(() => pushModal({
    onEscape: () => { if (canClose) onclose(); },
    onEnter: primaryEnter,
    enterDisabled: primaryEnterDisabled,
  }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  use:backdropClose={() => { if (canClose) onclose(); }}
>
  <div class="modal" class:modal-sql={(stage === "configure" || stage === "run") && isSql} role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <div class="title">{title}</div>
      <div class="step-indicator">{m.import_wizard_step_indicator({ n: stepNum, label: stepLabel })}</div>
    </header>
    <div class="body">
      {#if stage === "source"}
        <div class="file-row">
          <span class="label">{m.import_dialog_file_label()}</span>
          <span class="path">{fileName || m.sql_import_no_file_chosen()}</span>
          <button type="button" onclick={browse}>{m.import_dialog_browse()}</button>
        </div>
        {#if path}<div class="status">{m.import_wizard_format_label({ format: formatLabel })}</div>{/if}
        {#if showTarget}
          <TargetCollectionField
            value={targetColl}
            existingCollections={existingCollections}
            onInput={(v) => (targetColl = v)}
            errorKey={targetColl ? targetErrorMsg : null}
            notice={targetNotice}
          />
        {/if}
        {#if isSql}<div class="notice">{m.sql_import_scope_notice()}</div>{/if}
        {#if pendingLargeFile}
          <div class="notice">{m.import_dialog_large_file_notice({ size: formatFileSize(pendingSize) })}</div>
        {/if}
      {:else if stage === "configure"}
        <div class="file-row"><span class="label">{m.import_dialog_file_label()}</span><span class="path">{fileName}</span></div>
        <div class="insert-mode-group">
          <span class="label">{m.import_dialog_insert_mode_label()}</span>
          <label><input type="radio" name="insert-mode" checked={insertMode === "skipDuplicates"} onchange={() => (insertMode = "skipDuplicates")} /> {m.import_dialog_insert_mode_skip()}</label>
          <label><input type="radio" name="insert-mode" checked={insertMode === "upsertById"} onchange={() => (insertMode = "upsertById")} /> {m.import_dialog_insert_mode_upsert()}</label>
          <label><input type="radio" name="insert-mode" checked={insertMode === "stopOnFirstError"} onchange={() => (insertMode = "stopOnFirstError")} /> {m.import_dialog_insert_mode_stop()}</label>
        </div>

        {#if metadataBundle}
          <label class="metadata-toggle">
            <input type="checkbox" bind:checked={restoreMetadata} />
            {m.import_dialog_restore_metadata({ file: metadataPathFor(path).replace(/^.*[\\/]/, "") })}
          </label>
        {/if}

        {#if isSql}
          {@const v = sql!}
          <div class="notice">{m.sql_import_scope_notice()}</div>
          {#if v.phase === "loading"}
            <div class="status">{m.common_loading()}</div>
          {:else if v.tables.length === 0}
            <div class="status">{m.sql_import_no_tables()}</div>
          {:else}
            {@const notice = v.selected.size > 0 ? sqlTargetNotice(v) : null}
            <TargetCollectionField
              value={v.targetColl}
              existingCollections={existingCollections}
              onInput={(x) => v.setTargetColl(x)}
              errorKey={v.targetColl && sqlTargetError ? sqlTargetError : null}
              notice={notice}
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
        {:else if isCsv}
          {@const v = csv!}
          {#if v.phase === "loading"}
            <div class="status">{m.common_loading()}</div>
          {:else}
            <div class="csv-options">
              <label class="csv-radio-group">
                <span class="label">{m.csv_import_delimiter_label()}</span>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "comma"} onchange={() => v.setDelimiter("comma")} /> {m.csv_import_delimiter_comma()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "semicolon"} onchange={() => v.setDelimiter("semicolon")} /> {m.csv_import_delimiter_semicolon()}</label>
                <label><input type="radio" name="csv-delim" checked={v.delimiter === "tab"} onchange={() => v.setDelimiter("tab")} /> {m.csv_import_delimiter_tab()}</label>
              </label>
              <label class="csv-checkbox"><input type="checkbox" checked={v.parseJsonLike} onchange={() => v.toggleParseJsonLike()} /> {m.csv_import_parse_json_like()}</label>
              <label class="csv-checkbox"><input type="checkbox" checked={v.inferScalars} onchange={() => v.toggleInferScalars()} /> {m.csv_import_infer_scalars()}</label>
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
            {#if v.error}<div class="error">{v.error}</div>{/if}
          {/if}
        {/if}
      {:else}
        <div class="file-row"><span class="label">{m.import_dialog_file_label()}</span><span class="path">{fileName}</span></div>

        {#if isSql}
          {@const v = sql!}
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
        {:else if isCsv}
          {@const v = csv!}
          {#if v.phase === "running"}
            {#if v.progress}
              <ImportProgressBar done={v.progress.done} total={v.progress.total} label={`${v.progress.done}/${v.progress.total}`} />
            {:else}
              <ImportProgressBar done={0} total={0} label={m.import_dialog_progress_unknown()} unknown={true} />
            {/if}
          {:else if v.phase === "done"}
            {@const r = v.result!}
            <ImportResultSummary inserted={r.inserted} failed={r.failed} errors={r.errors} />
          {/if}
          {#if v.error}<div class="error">{v.error}</div>{/if}
          {#if v.metadataError}<div class="notice">{m.import_dialog_metadata_error({ error: v.metadataError })}</div>{/if}
        {:else}
          {@const j = job!}
          {#if j.total > 0}
            <ImportProgressBar done={j.done} total={j.total} label={m.import_dialog_progress({ done: j.done, total: j.total })} />
          {:else if j.running}
            <ImportProgressBar done={0} total={0} label={m.import_dialog_progress_unknown()} unknown={true} />
          {/if}
          {#if j.error}
            <div class="error">{m.import_dialog_error_title()}: {j.error}</div>
          {:else if j.result}
            {@const r = j.result}
            <ImportResultSummary inserted={r.inserted} failed={r.failed} errors={r.errors} />
          {/if}
          {#if j.metadataError}<div class="notice">{m.import_dialog_metadata_error({ error: j.metadataError })}</div>{/if}
        {/if}
      {/if}
    </div>
    <footer>
      {#if stage === "source"}
        {#if pendingLargeFile}
          <button type="button" onclick={cancelLargeFile}>{m.common_cancel()}</button>
          <button type="button" class="primary" onclick={confirmLargeFile}>{m.import_dialog_large_file_continue()}</button>
        {:else}
          <button type="button" onclick={onclose}>{m.common_cancel()}</button>
          <button type="button" class="primary" disabled={!path || (showTarget && !!targetErrorMsg)} onclick={goConfigure}>{m.import_dialog_next()}</button>
        {/if}
      {:else if stage === "configure"}
        <button type="button" onclick={goBack}>{m.import_dialog_back()}</button>
        <button type="button" onclick={onclose}>{m.common_cancel()}</button>
        {#if isSql}
          <button type="button" class="primary" disabled={sql!.selected.size === 0 || !!sqlTargetError} onclick={goRun}>{m.sql_import_run({ count: sql!.selected.size })}</button>
        {:else if isCsv}
          <button type="button" class="primary" disabled={csv!.columns.length === 0 || csv!.phase === "loading"} onclick={goRun}>{m.import_dialog_run()}</button>
        {:else}
          <button type="button" class="primary" onclick={goRun}>{m.import_dialog_run()}</button>
        {/if}
      {:else if isSql && sql!.phase === "running"}
        <button type="button" onclick={() => sql!.cancel()}>{m.common_cancel()}</button>
      {:else}
        {#if (isSql && sql!.phase !== "running" && sql!.phase !== "done") || (isCsv && csv!.phase !== "running" && csv!.phase !== "done")}
          <button type="button" onclick={goBackToConfigure}>{m.import_dialog_back()}</button>
        {/if}
        <button type="button" class="primary" onclick={onclose} disabled={!canClose}>{m.common_close()}</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: var(--backdrop); display: flex; align-items: center; justify-content: center; z-index: 1000; overflow-y: auto; }
  .modal { background: var(--panel); width: 30rem; max-width: 94vw; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-lg); }
  .modal-sql { width: 32rem; max-height: 85vh; display: flex; flex-direction: column; }
  header { padding: 0.625rem 0.875rem; border-bottom: 1px solid var(--bg); flex: none; }
  header .title { font-weight: 600; }
  header .step-indicator { margin-top: 0.125rem; font-size: 0.6875rem; color: var(--gray-77); }
  .body { padding: 0.875rem; font-size: 0.8125rem; overflow: auto; min-height: 0; }
  .file-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .file-row button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; flex: none; }
  .file-row button:hover { background: var(--bg); }
  .label { color: var(--gray-77); flex: none; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: var(--fs); margin-bottom: 0.75rem; }
  .notice-cancelled { background: var(--warn-bg); color: var(--warn-fg); }
  .insert-mode-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; font-size: var(--fs); margin-bottom: 0.75rem; }
  .insert-mode-group .label { color: var(--gray-77); }
  .insert-mode-group label { display: flex; align-items: center; gap: 0.25rem; cursor: pointer; }
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
</style>
