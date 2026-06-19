<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionInfo } from "../stores/collectionInfo.svelte";
  import { formatBytes, formatCount } from "../domain/stats";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createCollectionInfo(db, coll));

  onMount(() => {
    v.init();
  });
</script>

<div class="infopanel">
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">Đang tải…</div>{/if}

  {#if v.stats}
    {@const s = v.stats}
    <h3>Storage</h3>
    <table class="kv">
      <tbody>
        <tr><th>Namespace</th><td>{s.ns}</td></tr>
        <tr><th>Documents</th><td>{formatCount(s.count)}</td></tr>
        <tr><th>Data size</th><td>{formatBytes(s.size)}</td></tr>
        <tr><th>Avg obj size</th><td>{formatBytes(s.avgObjSize)}</td></tr>
        <tr><th>Storage size</th><td>{formatBytes(s.storageSize)}</td></tr>
        <tr><th>Total index size</th><td>{formatBytes(s.totalIndexSize)}</td></tr>
        <tr><th>Indexes</th><td>{formatCount(s.nindexes)}</td></tr>
        <tr><th>Capped</th><td>{s.capped ? "yes" : "no"}</td></tr>
      </tbody>
    </table>

    {#if s.indexSizes.length}
      <h3>Index sizes</h3>
      <table class="kv">
        <tbody>
          {#each s.indexSizes as ix (ix.name)}
            <tr><th>{ix.name}</th><td>{formatBytes(ix.bytes)}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  {#if v.options}
    {@const o = v.options}
    <h3>Options &amp; validator</h3>
    <table class="kv">
      <tbody>
        <tr><th>Validation level</th><td>{o.validationLevel ?? "—"}</td></tr>
        <tr><th>Validation action</th><td>{o.validationAction ?? "—"}</td></tr>
        <tr><th>Capped</th><td>{o.capped ? "yes" : "no"}</td></tr>
        {#if o.capped}
          <tr><th>Capped size</th><td>{formatBytes(o.size)}</td></tr>
          <tr><th>Max documents</th><td>{formatCount(o.max)}</td></tr>
        {/if}
      </tbody>
    </table>
    {#if o.validatorJson}
      <pre>{o.validatorJson}</pre>
    {:else}
      <div class="muted">Không có validator</div>
    {/if}
    {#if o.rawJson !== "{}"}
      <h3>Raw options</h3>
      <pre>{o.rawJson}</pre>
    {/if}
  {/if}
</div>

<style>
  .infopanel { overflow: auto; height: 100%; padding: 12px 16px; font-size: 13px; }
  h3 { margin: 16px 0 6px; font-size: 13px; color: #444; }
  h3:first-child { margin-top: 0; }
  table.kv { border-collapse: collapse; }
  table.kv th { text-align: left; font-weight: 500; color: #666; padding: 3px 16px 3px 0; vertical-align: top; }
  table.kv td { padding: 3px 0; font-family: ui-monospace, monospace; }
  pre { background: #f7f7f7; border: 1px solid #eee; border-radius: 4px; padding: 10px; overflow: auto; font-size: 12px; }
  .muted { color: #888; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px 0; color: #777; font-size: 12px; }
</style>
