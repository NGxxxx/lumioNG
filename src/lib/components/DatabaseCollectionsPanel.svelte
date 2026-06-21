<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createDatabaseCollections, type SortCol } from "../stores/databaseCollections.svelte";
  import { formatBytes, formatCount } from "../domain/stats";

  let { db, onopen }: { db: string; onopen: (coll: string) => void } = $props();
  const v = untrack(() => createDatabaseCollections(db));
  onMount(() => v.init());

  const cols: { key: SortCol; label: string }[] = [
    { key: "name", label: "Collection" },
    { key: "count", label: "Documents" },
    { key: "avgObjSize", label: "Avg size" },
    { key: "storageSize", label: "Storage size" },
    { key: "nindexes", label: "#Indexes" },
    { key: "totalIndexSize", label: "Index size" },
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
  <div class="bar"><button onclick={() => v.loadAll()}>Load stats</button></div>
  <table class="grid">
    <thead>
      <tr>
        {#each cols as c (c.key)}
          <th onclick={() => v.setSort(c.key)}>{c.label}{arrow(c.key)}</th>
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
            <td colspan="5" class="muted">Loading…</td>
          {:else if r.state === "error"}
            <td colspan="5" class="error-cell">{r.error}</td>
          {:else}
            <td colspan="5"><button class="link" onclick={() => v.loadStats(r.name)}>Load stats</button></td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .dbpanel { overflow: auto; height: 100%; padding: 12px 16px; font-size: 13px; }
  .summary { color: var(--th-fg); margin-bottom: 10px; }
  .bar { margin-bottom: 8px; }
  table.grid { border-collapse: collapse; width: 100%; }
  table.grid th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 4px 12px 4px 0; border-bottom: 1px solid var(--cell-border); cursor: pointer; user-select: none; }
  table.grid td { padding: 4px 12px 4px 0; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--row-divider); }
  .name { color: var(--text-strong); }
  .muted { color: var(--muted); }
  .error, .error-cell { color: var(--error); }
  .error { background: var(--error-bg); padding: 6px 10px; }
  .link { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: 12px; }
</style>
