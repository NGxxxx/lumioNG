<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createDatabaseCollections, type SortCol } from "../stores/databaseCollections.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatBytes, formatCount } from "../domain/stats";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import type { ExportWizardInput } from "../domain/exportPlan";
  import { toast } from "../stores/toast.svelte";
  import { createDbIndexCheck, type DbIndexCheck } from "../stores/dbIndexCheck.svelte";
  import DbIndexCheckPanel from "./DbIndexCheckPanel.svelte";
  import { createDbDiagram, type DbDiagram } from "../stores/dbDiagram.svelte";
  import DatabaseDiagram from "./DatabaseDiagram.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { db, onopen, onopenindexes, onopenfilter }: {
    db: string;
    onopen: (coll: string) => void;
    /** Opens a collection's Data view with a filter (from a relationship-diagram edge). */
    onopenfilter?: (coll: string, filter: string) => void;
    /** Opens a collection on its Indexes view (from the database-wide index check). */
    onopenindexes?: (coll: string) => void;
  } = $props();
  // Pass the ACTIVE session's tree — the default `namespaceTree` singleton stays empty in multi-session mode.
  const v = untrack(() =>
    createDatabaseCollections(sessionManager.active?.id ?? "", db, sessionManager.active?.tree),
  );
  onMount(() => {
    v.init();
    return () => {
      indexCheck?.cancel();
      diagram?.cancel();
    };
  });

  const cols: { key: SortCol; label: () => string }[] = [
    { key: "name", label: () => m.db_collections_col_collection() },
    { key: "count", label: () => m.db_collections_col_documents() },
    { key: "avgObjSize", label: () => m.db_collections_col_avg_size() },
    { key: "storageSize", label: () => m.db_collections_col_storage_size() },
    { key: "nindexes", label: () => m.db_collections_col_indexes() },
    { key: "totalIndexSize", label: () => m.db_collections_col_index_size() },
  ];
  const arrow = (k: SortCol) => (v.sortCol === k ? (v.sortDir === "asc" ? " ▲" : " ▼") : "");

  // Multi-select for bulk truncate/drop/export.
  let selected = $state<Set<string>>(new Set());
  const allSelected = $derived(v.rows.length > 0 && v.rows.every((r) => selected.has(r.name)));

  function toggleRow(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    selected = next;
  }
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(v.rows.map((r) => r.name));
  }

  let exportWizard = $state<ExportWizardInput | null>(null);

  // Database-wide index check: nothing runs until the button is clicked; results are dropped on close.
  let indexCheck = $state<DbIndexCheck | null>(null);
  function startIndexCheck() {
    indexCheck?.cancel();
    indexCheck = createDbIndexCheck(sessionManager.active?.id ?? "", db, () => v.rows.map((r) => r.name));
    void indexCheck.start();
  }
  function closeIndexCheck() {
    indexCheck?.cancel();
    indexCheck = null;
  }

  // Relationship diagram: inferred only when the user presses Analyze; dropped on close.
  let diagram = $state<DbDiagram | null>(null);
  function openDiagram() {
    diagram?.cancel();
    diagram = createDbDiagram(sessionManager.active?.id ?? "", db, sessionManager.active?.connId ?? null);
    void diagram.start();
  }
  function closeDiagram() {
    diagram?.cancel();
    diagram = null;
  }

  function runBulk(action: "truncate" | "drop") {
    v.requestBulk(action, [...selected], (failed) => {
      selected = new Set(failed);
      if (failed.length > 0) toast.push(m.db_collections_bulk_failed({ names: failed.join(", ") }), "error");
    });
  }

  function openBulkExport() {
    exportWizard = { mode: "pick", preChecked: [...selected].map((coll) => ({ db, coll })) };
  }
</script>

<div class="dbpanel">
  {#if v.summary}
    {@const s = v.summary}
    <div class="summary">
      {m.db_collections_summary({ collections: formatCount(s.collections), objects: formatCount(s.objects), data: formatBytes(s.dataSize), storage: formatBytes(s.storageSize) })}
    </div>
  {/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <div class="bar">
    <button onclick={() => v.loadAll()}>{m.db_collections_load_stats()}</button>
    <button onclick={startIndexCheck} disabled={indexCheck?.running}>{m.dbidx_check()}</button>
    <button onclick={openDiagram} disabled={diagram?.running}>{m.dbdiag_open()}</button>
    {#if selected.size > 0}
      <span class="sel-count">{m.db_collections_selected_count({ count: selected.size })}</span>
      <button onclick={() => runBulk("truncate")}>{m.db_collections_bulk_truncate()}</button>
      <button class="danger" onclick={() => runBulk("drop")}>{m.db_collections_bulk_drop()}</button>
      <button onclick={openBulkExport}>{m.db_collections_bulk_export()}</button>
    {/if}
  </div>
  {#if diagram}
    <DatabaseDiagram {diagram} {db} onclose={closeDiagram} onopenfilter={(c, f) => (onopenfilter ?? ((coll) => onopen(coll)))(c, f)} />
  {/if}
  {#if indexCheck}
    <DbIndexCheckPanel check={indexCheck} onopen={(c) => (onopenindexes ?? onopen)(c)} onclose={closeIndexCheck} />
  {/if}
  <table class="grid">
    <thead>
      <tr>
        <th class="checkcol"><input type="checkbox" checked={allSelected} onchange={toggleAll} aria-label={m.db_collections_select_all()} /></th>
        {#each cols as c (c.key)}
          <th onclick={() => v.setSort(c.key)}>{c.label()}{arrow(c.key)}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each v.rows as r (r.name)}
        <tr ondblclick={() => onopen(r.name)}>
          <td class="checkcol">
            <input
              type="checkbox"
              checked={selected.has(r.name)}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleRow(r.name)}
              aria-label={`select-${r.name}`}
            />
          </td>
          <td class="name">{r.name}</td>
          {#if r.state === "loaded" && r.stats}
            {@const st = r.stats}
            <td>{formatCount(st.count)}</td>
            <td>{formatBytes(st.avgObjSize)}</td>
            <td>{formatBytes(st.storageSize)}</td>
            <td>{formatCount(st.nindexes)}</td>
            <td>{formatBytes(st.totalIndexSize)}</td>
          {:else if r.state === "loading"}
            <td colspan="5" class="muted">{m.common_loading()}</td>
          {:else if r.state === "error"}
            <td colspan="5" class="error-cell">{r.error}</td>
          {:else}
            <td colspan="5"><button class="link" onclick={() => v.loadStats(r.name)}>{m.db_collections_load_stats()}</button></td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<DestructiveDialog gate={v.destructive} />

{#if exportWizard}
  <ExportWizard input={exportWizard} onclose={() => (exportWizard = null)} />
{/if}

<style>
  .dbpanel { overflow: auto; height: 100%; box-sizing: border-box; padding: 0.75rem 1rem; font-size: 0.8125rem; }
  .summary { color: var(--th-fg); margin-bottom: 0.625rem; }
  .bar { margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
  .bar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .bar button:hover { background: var(--bg); }
  .bar button.danger { color: var(--error); }
  .sel-count { color: var(--muted); margin-left: 0.25rem; }
  table.grid { border-collapse: collapse; width: 100%; user-select: none; }
  table.grid th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.75rem 0.25rem 0; border-bottom: 1px solid var(--cell-border); cursor: pointer; user-select: none; }
  table.grid td { padding: 0.25rem 0.75rem 0.25rem 0; font-family: var(--mono); border-bottom: 1px solid var(--row-divider); }
  .checkcol { width: 1.25rem; cursor: default; }
  .name { color: var(--text-strong); }
  .muted { color: var(--muted); }
  .error, .error-cell { color: var(--error); }
  .error { background: var(--error-bg); padding: 0.375rem 0.625rem; }
  .link { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: var(--fs); }
</style>
