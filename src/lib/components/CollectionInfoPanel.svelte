<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionInfo } from "../stores/collectionInfo.svelte";
  import { formatBytes, formatCount } from "../domain/stats";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createCollectionInfo(db, coll));

  onMount(() => {
    v.init();
  });
</script>

<div class="infopanel">
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}

  {#if v.stats}
    {@const s = v.stats}
    <h3>{m.collection_info_storage_heading()}</h3>
    <table class="kv">
      <tbody>
        <tr><th>{m.collection_info_namespace()}</th><td>{s.ns}</td></tr>
        <tr><th>{m.collection_info_documents()}</th><td>{formatCount(s.count)}</td></tr>
        <tr><th>{m.collection_info_data_size()}</th><td>{formatBytes(s.size)}</td></tr>
        <tr><th>{m.collection_info_avg_obj_size()}</th><td>{formatBytes(s.avgObjSize)}</td></tr>
        <tr><th>{m.collection_info_storage_size()}</th><td>{formatBytes(s.storageSize)}</td></tr>
        <tr><th>{m.collection_info_total_index_size()}</th><td>{formatBytes(s.totalIndexSize)}</td></tr>
        <tr><th>{m.collection_info_indexes()}</th><td>{formatCount(s.nindexes)}</td></tr>
        <tr><th>{m.collection_info_capped()}</th><td>{s.capped ? m.common_yes() : m.common_no()}</td></tr>
      </tbody>
    </table>

    {#if s.indexSizes.length}
      <h3>{m.collection_info_index_sizes_heading()}</h3>
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
    <h3>{m.collection_info_options_heading()}</h3>
    <table class="kv">
      <tbody>
        <tr><th>{m.collection_info_validation_level()}</th><td>{o.validationLevel ?? "—"}</td></tr>
        <tr><th>{m.collection_info_validation_action()}</th><td>{o.validationAction ?? "—"}</td></tr>
        <tr><th>{m.collection_info_capped()}</th><td>{o.capped ? m.common_yes() : m.common_no()}</td></tr>
        {#if o.capped}
          <tr><th>{m.collection_info_capped_size()}</th><td>{formatBytes(o.size)}</td></tr>
          <tr><th>{m.collection_info_max_documents()}</th><td>{formatCount(o.max)}</td></tr>
        {/if}
      </tbody>
    </table>
    {#if o.validatorJson}
      <pre>{o.validatorJson}</pre>
    {:else}
      <div class="muted">{m.collection_info_no_validator()}</div>
    {/if}
    {#if o.rawJson !== "{}"}
      <h3>{m.collection_info_raw_options_heading()}</h3>
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
