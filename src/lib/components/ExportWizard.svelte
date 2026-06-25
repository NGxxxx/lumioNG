<script lang="ts">
  import { untrack } from "svelte";
  import { portal } from "../actions/portal";
  import { namespaceTree } from "../stores/namespaceTree.svelte";
  import { createExportJob, type ExportFormat, type ExportTarget } from "../stores/exportJob.svelte";
  import { targetKey, buildTargets, buildExportProjection, pickColumns, type ExportWizardInput } from "../domain/exportPlan";
  import { saveDialog, openDirDialog } from "../api/files";
  import * as m from "$lib/paraglide/messages";

  let { input, onclose }: { input: ExportWizardInput; onclose: () => void } = $props();

  let format = $state<ExportFormat>("json");
  let dir = $state<string | null>(null);
  let error = $state<string | null>(null);
  let job = $state<ReturnType<typeof createExportJob> | null>(null);

  // Picker checkbox state (keys are targetKey(db, coll)).
  let checked = $state<Set<string>>(
    untrack(() => new Set(input.mode === "pick" ? input.preChecked.map((t) => targetKey(t.db, t.coll)) : [])),
  );
  // Scoped column selection (path -> selected).
  let cols = $state<{ path: string; sel: boolean }[]>(
    untrack(() => (input.mode === "pick" ? [] : input.columns.map((c) => ({ path: c.path, sel: c.visible })))),
  );

  const isMemory = $derived(input.mode === "scopedMemory");

  function collsOf(db: string): string[] {
    return namespaceTree.databases.find((d) => d.name === db)?.collections ?? [];
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
    for (const d of namespaceTree.databases) for (const c of d.collections) next.add(targetKey(d.name, c));
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
    const d = await openDirDialog();
    if (d !== null) dir = d;
  }

  async function start() {
    error = null;
    const ext = format;
    const selectedPaths = cols.filter((c) => c.sel).map((c) => c.path);
    const allPaths = cols.map((c) => c.path);

    if (input.mode === "pick") {
      const targets = buildTargets(namespaceTree.databases, checked);
      if (targets.length === 0) { error = m.export_wizard_no_targets(); return; }
      if (dir === null) { await chooseFolder(); if (dir === null) return; }
      const exTargets: ExportTarget[] = targets.map((t) => ({
        db: t.db, coll: t.coll,
        source: { kind: "query", filter: "{}", sort: null, projection: null },
      }));
      job = createExportJob({ targets: exTargets, format, dir: dir! });
      await job.run();
      return;
    }

    // Scoped: single file.
    const name = `${input.coll}.${ext}`;
    const path = await saveDialog(name, [{ name: ext.toUpperCase(), extensions: [ext] }]);
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
    job = createExportJob({ targets: [target], format, filePath: path });
    await job.run();
  }

  function statusLabel(s: string): string {
    return s === "pending" ? m.export_wizard_status_pending()
      : s === "running" ? m.export_wizard_status_running()
      : s === "done" ? m.export_wizard_status_done()
      : m.export_wizard_status_error();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && !job?.running && onclose()} />

<div class="backdrop" use:portal role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !job?.running) onclose(); }}>
  <div class="modal" class:running={job !== null} role="dialog" aria-modal="true" aria-label={m.export_wizard_title()}>
    <header>{m.export_wizard_title()}</header>

    {#if job === null}
      <div class="body">
        {#if input.mode !== "pick"}<p class="summary">{input.summary}</p>{/if}

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
                {#each namespaceTree.databases as d (d.name)}
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
            </fieldset>

            {#if input.mode === "pick"}
              <fieldset>
                <legend>{m.export_wizard_destination()}</legend>
                <button type="button" onclick={chooseFolder}>{m.export_wizard_choose_folder()}</button>
                <p class="dir" title={dir ?? ""}>{dir ? m.export_wizard_folder_label({ dir }) : m.export_wizard_no_folder()}</p>
              </fieldset>
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
        {:else}
          <button type="button" class="primary" onclick={onclose}>{m.export_wizard_close()}</button>
        {/if}
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: #fff; width: 40rem; max-width: 94vw; border-radius: 0.375rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
  .modal.running { width: 35rem; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .summary { margin: 0 0 0.625rem; color: #444; }

  /* Two-column layout (HeidiSQL-style): left = what to export, right = options */
  .cols-2 { display: flex; gap: 0.75rem; align-items: stretch; }
  .panel { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; border: 1px solid #e2e2e2; border-radius: 0.25rem; overflow: hidden; }
  .panel-bar { display: flex; align-items: center; gap: 0.625rem; padding: 0.3125rem 0.5rem; border-bottom: 1px solid #eee; background: #fafafa; }
  .panel-title { font-size: 0.75rem; color: #777; }
  .panel-bar .count { margin-left: auto; color: #777; font-size: 0.75rem; }
  .panel-bar .link:last-of-type { margin-left: 0; }
  .link { border: none; background: none; color: #2563c9; cursor: pointer; padding: 0; font-size: 0.75rem; }
  .link:hover { text-decoration: underline; }

  /* Scrollable list — behaves like the namespace sidebar when long */
  .scroll { flex: 1; min-height: 7.5rem; max-height: 46vh; overflow: auto; padding: 0.25rem 0; }
  .db, .coll { display: flex; align-items: center; gap: 0.375rem; padding: 0.1875rem 0.5rem; cursor: pointer; }
  .db { font-weight: 600; }
  .db-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-count { margin-left: auto; color: #999; font-weight: 400; font-size: 0.6875rem; }
  .coll { padding-left: 1.625rem; font-weight: 400; }
  .coll span, .db-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scroll label:hover { background: #f1f5fb; }

  .options { flex: 0 0 12.25rem; display: flex; flex-direction: column; gap: 0.625rem; }
  fieldset { border: 1px solid #e2e2e2; border-radius: 0.25rem; padding: 0.5rem 0.625rem; margin: 0; }
  legend { font-size: 0.75rem; color: #777; padding: 0 0.25rem; }
  .options label { display: block; padding: 0.125rem 0; }
  .dir { margin: 0.375rem 0 0; color: #666; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid #eee; }
  .primary { font-weight: 600; }

  /* Running phase */
  .rows-scroll { max-height: 50vh; overflow: auto; }
  table.rows { width: 100%; border-collapse: collapse; }
  table.rows th, table.rows td { text-align: left; padding: 0.1875rem 0.5rem 0.1875rem 0; border-bottom: 1px solid #eee; }
  table.rows th { position: sticky; top: 0; background: #fff; }
  td.done { color: #1b5e20; } td.error { color: #b71c1c; } td.running { color: #0b5; }
  .overall { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.625rem; }
  .bar { flex: 1; height: 0.5rem; background: #eee; border-radius: 0.25rem; overflow: hidden; }
  .fill { height: 100%; background: #4c7; transition: width .2s; }
  .error { background: #fdecea; color: #b71c1c; padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; }
  .io-ok { background: #e6f4ea; color: #1b5e20; padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; }
</style>
