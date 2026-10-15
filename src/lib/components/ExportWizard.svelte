<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "#lib/stores/modalStack.js";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createExportJob, type ExportFormat, type ExportTarget } from "../stores/exportJob.svelte";
  import { jobs, exportJobSource, exportTargetLabel } from "../stores/jobs.svelte";
  import { targetKey, buildTargets, buildExportProjection, pickColumns, countLossyExportFields, type ExportWizardInput } from "../domain/exportPlan";
  import type { BsonType } from "../domain/extjson";
  import { pickSavePath, pickDirectory } from "../stores/desktop";
  import * as m from "#lib/paraglide/messages.js";

  let { input, onclose }: { input: ExportWizardInput; onclose: () => void } = $props();

  let format = $state<ExportFormat>("json");
  let includeMetadata = $state(false);
  let dir = $state<string | null>(null);
  let error = $state<string | null>(null);
  let job = $state<ReturnType<typeof createExportJob> | null>(null);

  // Picker checkbox state (keys are targetKey(db, coll)).
  let checked = $state<Set<string>>(
    untrack(() => new Set(input.mode === "pick" ? input.preChecked.map((t) => targetKey(t.db, t.coll)) : [])),
  );
  // Scoped column selection (path -> selected).
  let cols = $state<{ path: string; sel: boolean; type?: BsonType }[]>(
    untrack(() => (input.mode === "pick" ? [] : input.columns.map((c) => ({ path: c.path, sel: c.visible, type: c.type })))),
  );

  const isMemory = $derived(input.mode === "scopedMemory");

  const nestedCount = $derived(
    input.mode !== "pick" && (format === "csv" || format === "sql")
      ? countLossyExportFields(cols.filter((c) => c.sel), format)
      : 0,
  );

  // Tree-driven ("pick") mode exports the ACTIVE session; guard so a null active session shows no DBs.
  const databases = $derived(sessionManager.active?.tree?.databases ?? []);

  function collsOf(db: string): string[] {
    return databases.find((d) => d.name === db)?.collections ?? [];
  }
  function dbSelectedCount(db: string): number {
    return collsOf(db).filter((c) => checked.has(targetKey(db, c))).length;
  }
  function toggleTarget(db: string, coll: string) {
    const k = targetKey(db, coll);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k); else next.add(k);
    checked = next;
  }
  /** Toggle every collection of a database: select all unless already all-selected, else clear them. */
  function toggleDb(db: string) {
    const colls = collsOf(db);
    const all = colls.length > 0 && colls.every((c) => checked.has(targetKey(db, c)));
    const next = new Set(checked);
    for (const c of colls) {
      const k = targetKey(db, c);
      if (all) next.delete(k); else next.add(k);
    }
    checked = next;
  }
  function selectAll() {
    const next = new Set<string>();
    for (const d of databases) for (const c of d.collections) next.add(targetKey(d.name, c));
    checked = next;
  }
  function clearAll() {
    checked = new Set();
  }

  function toggleCol(i: number) {
    cols[i] = { ...cols[i], sel: !cols[i].sel };
    cols = [...cols];
  }
  function selectAllCols(sel: boolean) {
    cols = cols.map((c) => ({ ...c, sel }));
  }

  async function chooseFolder() {
    const d = await pickDirectory();
    if (d !== null) dir = d;
  }

  async function start() {
    error = null;
    const ext = format;
    const selectedPaths = cols.filter((c) => c.sel).map((c) => c.path);
    const allPaths = cols.map((c) => c.path);

    if (input.mode === "pick") {
      const targets = buildTargets(databases, checked);
      if (targets.length === 0) { error = m.export_wizard_no_targets(); return; }
      if (dir === null) { await chooseFolder(); if (dir === null) return; }
      const exTargets: ExportTarget[] = targets.map((t) => ({
        db: t.db, coll: t.coll,
        source: { kind: "query", filter: "{}", sort: null, projection: null },
      }));
      job = createExportJob(sessionManager.active!.id, { targets: exTargets, format, dir: dir!, includeMetadata });
      jobs.register(exportJobSource(job, exportTargetLabel(exTargets, null)));
      await job.run();
      return;
    }

    // Scoped: single file.
    const name = `${input.coll}.${ext}`;
    const path = await pickSavePath(name, ext);
    if (path === null) return;

    let target: ExportTarget;
    if (input.mode === "scopedMemory") {
      target = { db: "", coll: input.coll, source: { kind: "memory", docs: pickColumns(input.docs, selectedPaths) } };
    } else {
      target = {
        db: input.db, coll: input.coll,
        source: { kind: "query", filter: input.filter, sort: input.sort, projection: buildExportProjection(allPaths, selectedPaths) },
      };
    }
    job = createExportJob(sessionManager.active!.id, {
      targets: [target], format, filePath: path,
      includeMetadata: input.mode === "scopedCollection" && includeMetadata,
    });
    jobs.register(exportJobSource(job, exportTargetLabel(null, path)));
    await job.run();
  }

  function statusLabel(s: string): string {
    return s === "pending" ? m.export_wizard_status_pending()
      : s === "running" ? m.export_wizard_status_running()
      : s === "done" ? m.export_wizard_status_done()
      : m.export_wizard_status_error();
  }

  function primaryEnter() {
    if (job === null) { start(); return; }
    if (!job.running) onclose();
  }

  function primaryEnterDisabled(): boolean {
    return job !== null && job.running;
  }

  onMount(() => pushModal({
    onEscape: () => { if (!job?.running) onclose(); },
    onEnter: primaryEnter,
    enterDisabled: primaryEnterDisabled,
  }));
</script>

<div class="backdrop" use:portal role="presentation" use:backdropClose={() => { if (!job?.running) onclose(); }}>
  <div class="modal" class:running={job !== null} role="dialog" aria-modal="true" aria-label={m.export_wizard_title()}>
    <header>{m.export_wizard_title()}</header>

    {#if job === null}
      <div class="body">
        {#if input.mode !== "pick"}<p class="summary">{input.summary}</p>{/if}
        {#if format === "sql"}<p class="notice">{m.sql_export_scope_notice()}</p>{/if}
        {#if nestedCount > 0}<p class="notice">{m.export_wizard_nested_field_notice({ n: nestedCount })}</p>{/if}

        <div class="cols-2">
          <!-- Left: what to export -->
          <div class="panel">
            {#if input.mode === "pick"}
              <div class="panel-bar">
                <button type="button" class="link" onclick={selectAll}>{m.export_wizard_select_all()}</button>
                <button type="button" class="link" onclick={clearAll}>{m.export_wizard_clear()}</button>
                <span class="count">{m.export_wizard_selected_count({ n: checked.size })}</span>
              </div>
              <div class="scroll">
                {#each databases as d (d.name)}
                  {@const total = d.collections.length}
                  {@const sel = dbSelectedCount(d.name)}
                  <label class="db">
                    <input type="checkbox" checked={total > 0 && sel === total} onchange={() => toggleDb(d.name)} />
                    <span class="db-name">{d.name}</span>
                    <span class="db-count">{sel}/{total}</span>
                  </label>
                  {#each d.collections as c (c)}
                    <label class="coll">
                      <input type="checkbox" checked={checked.has(targetKey(d.name, c))} onchange={() => toggleTarget(d.name, c)} />
                      <span>{c}</span>
                    </label>
                  {/each}
                {/each}
              </div>
            {:else}
              <div class="panel-bar">
                <span class="panel-title">{m.export_wizard_columns()}</span>
                <button type="button" class="link" onclick={() => selectAllCols(true)}>{m.export_wizard_select_all()}</button>
                <button type="button" class="link" onclick={() => selectAllCols(false)}>{m.export_wizard_clear()}</button>
              </div>
              <div class="scroll">
                {#each cols as c, i (c.path)}
                  <label class="coll">
                    <input type="checkbox" checked={c.sel} onchange={() => toggleCol(i)} />
                    <span>{c.path}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Right: options -->
          <div class="options">
            <fieldset>
              <legend>{m.export_wizard_format()}</legend>
              <label><input type="radio" name="fmt" value="json" bind:group={format} /> JSON</label>
              <label><input type="radio" name="fmt" value="csv" bind:group={format} /> CSV</label>
              <label><input type="radio" name="fmt" value="bson" bind:group={format} disabled={isMemory} /> BSON</label>
              <label><input type="radio" name="fmt" value="sql" bind:group={format} /> SQL</label>
            </fieldset>

            {#if input.mode === "pick"}
              <fieldset>
                <legend>{m.export_wizard_destination()}</legend>
                <button type="button" onclick={chooseFolder}>{m.export_wizard_choose_folder()}</button>
                <p class="dir" title={dir ?? ""}>{dir ? m.export_wizard_folder_label({ dir }) : m.export_wizard_no_folder()}</p>
              </fieldset>
            {/if}

            {#if !isMemory}
              <label class="metadata-toggle">
                <input type="checkbox" bind:checked={includeMetadata} />
                {m.export_wizard_include_metadata()}
              </label>
            {/if}
          </div>
        </div>

        {#if error}<div class="error">{error}</div>{/if}
      </div>
      <footer>
        <button type="button" onclick={onclose}>{m.export_wizard_cancel()}</button>
        <button type="button" class="primary" onclick={start}>{m.export_wizard_run()}</button>
      </footer>
    {:else}
      {@const j = job}
      <div class="body">
        <div class="rows-scroll">
          <table class="rows">
            <thead><tr><th>{m.export_wizard_col_collection()}</th><th>{m.export_wizard_col_status()}</th><th>{m.export_wizard_col_progress()}</th></tr></thead>
            <tbody>
              {#each j.rows as r (r.db + "/" + r.coll)}
                <tr>
                  <td>{r.db ? `${r.db}.${r.coll}` : r.coll}</td>
                  <td class={r.status}>{statusLabel(r.status)}{r.error ? `: ${r.error}` : ""}</td>
                  <td>{r.done}{r.total ? ` / ${r.total}` : ""}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="overall">
          <div class="bar"><div class="fill" style="width:{j.overall.percent}%"></div></div>
          <span>{m.export_wizard_overall()}: {j.overall.percent}%</span>
        </div>
        {#if j.done}<div class="io-ok">{m.export_wizard_summary_done({ ok: j.succeeded, fail: j.failed })}</div>{/if}
      </div>
      <footer>
        {#if j.running}
          <button type="button" onclick={j.cancel}>{m.export_wizard_cancel()}</button>
          <!-- The job is a store: it keeps running after the wizard closes (status bar shows it). -->
          <button type="button" onclick={onclose}>{m.jobs_background()}</button>
        {:else}
          <button type="button" class="primary" onclick={onclose}>{m.export_wizard_close()}</button>
        {/if}
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: var(--backdrop); display: flex; align-items: center; justify-content: center; z-index: 1000; overflow-y: auto; }
  .modal { background: var(--popover); border: 1px solid var(--c-surface1); width: 40rem; max-width: 94vw; border-radius: 0.75rem; overflow: hidden; box-shadow: var(--shadow-lg); }
  .modal.running { width: 35rem; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .summary { margin: 0 0 0.625rem; color: var(--gray-44); }

  /* Two-column layout (HeidiSQL-style): left = what to export, right = options */
  .cols-2 { display: flex; gap: 0.75rem; align-items: stretch; }
  .panel { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .panel-bar { display: flex; align-items: center; gap: 0.625rem; padding: 0.3125rem 0.5rem; border-bottom: 1px solid var(--bg); background: var(--zebra); }
  .panel-title { font-size: var(--fs); color: var(--gray-77); }
  .panel-bar .count { margin-left: auto; color: var(--gray-77); font-size: var(--fs); }
  .panel-bar .link:last-of-type { margin-left: 0; }
  .link { border: none; background: none; color: var(--link-strong); cursor: pointer; padding: 0; font-size: var(--fs); }
  .link:hover { text-decoration: underline; }

  /* Scrollable list — behaves like the namespace sidebar when long */
  .scroll { flex: 1; min-height: 7.5rem; max-height: 46vh; overflow: auto; padding: 0.25rem 0; }
  .db, .coll { display: flex; align-items: center; gap: 0.375rem; padding: 0.1875rem 0.5rem; cursor: pointer; }
  .db { font-weight: 600; }
  .db-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-count { margin-left: auto; color: var(--gray-99); font-weight: var(--fw); font-size: 0.6875rem; }
  .coll { padding-left: 1.625rem; font-weight: var(--fw); }
  .coll span, .db-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scroll label:hover { background: var(--row-hover); }

  .options { flex: 0 0 12.25rem; display: flex; flex-direction: column; gap: 0.625rem; }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem 0.625rem; margin: 0; }
  fieldset button[type="button"]:not(.link) { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  fieldset button[type="button"]:not(.link):hover { background: var(--bg); }
  legend { font-size: var(--fs); color: var(--gray-77); padding: 0 0.25rem; }
  .options label { display: block; padding: 0.125rem 0; }
  .metadata-toggle { display: flex; align-items: center; gap: 0.375rem; cursor: pointer; }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: var(--fs); margin: 0 0 0.625rem; }
  .dir { margin: 0.375rem 0 0; color: var(--th-fg); font-size: var(--fs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--on-accent); border: none; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
  .primary { font-weight: 600; }

  /* Running phase */
  .rows-scroll { max-height: 50vh; overflow: auto; }
  table.rows { width: 100%; border-collapse: collapse; }
  table.rows th, table.rows td { text-align: left; padding: 0.1875rem 0.5rem 0.1875rem 0; border-bottom: 1px solid var(--bg); }
  table.rows th { position: sticky; top: 0; background: var(--panel); }
  td.done { color: var(--ok-fg); } td.error { color: var(--error); } td.running { color: var(--ok-strong); }
  .overall { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.625rem; }
  .bar { flex: 1; height: 0.5rem; background: var(--bg); border-radius: var(--radius); overflow: hidden; }
  .fill { height: 100%; background: var(--progress); transition: width .2s; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; }
  .io-ok { background: var(--ok-bg); color: var(--ok-fg); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; }
</style>
