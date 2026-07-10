<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createDatabaseCollections, type SortCol } from "../stores/databaseCollections.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatBytes, formatCount } from "../domain/stats";
  import * as m from "$lib/paraglide/messages";

  let { db, onopen }: { db: string; onopen: (coll: string) => void } = $props();
  // Pass the ACTIVE session's tree — the default `namespaceTree` singleton stays empty in multi-session mode.
  const v = untrack(() =>
    createDatabaseCollections(sessionManager.active?.id ?? "", db, sessionManager.active?.tree),
  );
  onMount(() => v.init());

  const cols: { key: SortCol; label: () => string }[] = [
    { key: "name", label: () => m.db_collections_col_collection() },
    { key: "count", label: () => m.db_collections_col_documents() },
    { key: "avgObjSize", label: () => m.db_collections_col_avg_size() },
    { key: "storageSize", label: () => m.db_collections_col_storage_size() },
    { key: "nindexes", label: () => m.db_collections_col_indexes() },
    { key: "totalIndexSize", label: () => m.db_collections_col_index_size() },
  ];
  const arrow = (k: SortCol) => (v.sortCol === k ? (v.sortDir === "asc" ? " ▲" : " ▼") : "");
</script>

<div class="dbpanel">
  {#if v.summary}
    {@const s = v.summary}
    <div class="summary">
      {formatCount(s.collections)} collections · {formatCount(s.objects)} objects ·
      {formatBytes(s.dataSize)} data · {formatBytes(s.storageSize)} storage
    </div>
  {/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <div class="bar"><button onclick={() => v.loadAll()}>{m.db_collections_load_stats()}</button></div>
  <table class="grid">
    <thead>
      <tr>
        {#each cols as c (c.key)}
          <th onclick={() => v.setSort(c.key)}>{c.label()}{arrow(c.key)}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each v.rows as r (r.name)}
        <tr ondblclick={() => onopen(r.name)}>
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

<style>
  .dbpanel { overflow: auto; height: 100%; padding: 0.75rem 1rem; font-size: 0.8125rem; }
  .summary { color: var(--th-fg); margin-bottom: 0.625rem; }
  .bar { margin-bottom: 0.5rem; }
  table.grid { border-collapse: collapse; width: 100%; user-select: none; }
  table.grid th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.75rem 0.25rem 0; border-bottom: 1px solid var(--cell-border); cursor: pointer; user-select: none; }
  table.grid td { padding: 0.25rem 0.75rem 0.25rem 0; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--row-divider); }
  .name { color: var(--text-strong); }
  .muted { color: var(--muted); }
  .error, .error-cell { color: var(--error); }
  .error { background: var(--error-bg); padding: 0.375rem 0.625rem; }
  .link { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: 0.75rem; }
</style>
