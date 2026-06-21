<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionSchema } from "../stores/collectionSchema.svelte";
  import { bsonTypeBadge } from "../domain/theme";
  import { formatPercent } from "../domain/stats";

  let { db, coll }: { db: string; coll: string } = $props();
  const v = untrack(() => createCollectionSchema(db, coll));
  onMount(() => v.init());
</script>

<div class="schemapanel">
  <div class="bar">
    <label>Sample size
      <input type="number" min="1" value={v.sampleSize}
        onchange={(e) => v.setSampleSize(Number((e.target as HTMLInputElement).value))} />
    </label>
    <button onclick={() => v.refresh()}>Re-sample</button>
    {#if v.actualSampled}<span class="muted">sampled {v.actualSampled} docs</span>{/if}
  </div>
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">Loading…</div>{/if}
  <table class="schema">
    <thead><tr><th>Field</th><th>Type</th><th>Presence</th><th>Mixed</th></tr></thead>
    <tbody>
      {#each v.fields as f (f.path)}
        {@const badge = bsonTypeBadge(f.type)}
        <tr>
          <td class="field">{f.path}</td>
          <td><span class="badge" style="color:{badge.color};background:{badge.bg}">{f.type}</span></td>
          <td>{formatPercent(f.presence)}</td>
          <td>{f.mixed ? "yes" : ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .schemapanel { overflow: auto; height: 100%; padding: 12px 16px; font-size: 13px; }
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .bar input { width: 70px; }
  .muted { color: #888; }
  table.schema { border-collapse: collapse; width: 100%; }
  table.schema th { text-align: left; font-weight: 500; color: #666; padding: 4px 12px 4px 0; border-bottom: 1px solid var(--cell-border); }
  table.schema td { padding: 4px 12px 4px 0; font-family: ui-monospace, monospace; border-bottom: 1px solid #f0f0f0; }
  .field { color: #1a1a1a; }
  .badge { padding: 1px 7px; border-radius: 9px; font-size: 11px; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px 0; color: #777; font-size: 12px; }
</style>
