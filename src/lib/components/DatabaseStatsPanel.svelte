<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createDatabaseStats } from "../stores/databaseStats.svelte";
  import { formatBytes, formatCount } from "../domain/stats";

  let { db }: { db: string } = $props();

  const v = untrack(() => createDatabaseStats(db));

  onMount(() => {
    v.init();
  });
</script>

<div class="infopanel">
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">Đang tải…</div>{/if}

  {#if v.stats}
    {@const s = v.stats}
    <h3>Database: {s.db}</h3>
    <table class="kv">
      <tbody>
        <tr><th>Collections</th><td>{formatCount(s.collections)}</td></tr>
        <tr><th>Objects</th><td>{formatCount(s.objects)}</td></tr>
        <tr><th>Data size</th><td>{formatBytes(s.dataSize)}</td></tr>
        <tr><th>Storage size</th><td>{formatBytes(s.storageSize)}</td></tr>
        <tr><th>Indexes</th><td>{formatCount(s.indexes)}</td></tr>
        <tr><th>Index size</th><td>{formatBytes(s.indexSize)}</td></tr>
      </tbody>
    </table>
  {/if}
</div>

<style>
  .infopanel { overflow: auto; height: 100%; padding: 12px 16px; font-size: 13px; }
  h3 { margin: 0 0 6px; font-size: 13px; color: #444; }
  table.kv { border-collapse: collapse; }
  table.kv th { text-align: left; font-weight: 500; color: #666; padding: 3px 16px 3px 0; }
  table.kv td { padding: 3px 0; font-family: ui-monospace, monospace; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px 0; color: #777; font-size: 12px; }
</style>
