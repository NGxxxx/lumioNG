<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionSchema } from "../stores/collectionSchema.svelte";
  import { bsonTypeBadge } from "../domain/theme";
  import { formatPercent } from "../domain/stats";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();
  const v = untrack(() => createCollectionSchema(db, coll));
  onMount(() => v.init());
</script>

<div class="schemapanel">
  <div class="bar">
    <label>{m.schema_panel_sample_size_label()}
      <input type="number" min="1" value={v.sampleSize}
        onchange={(e) => v.setSampleSize(Number((e.target as HTMLInputElement).value))} />
    </label>
    <button onclick={() => v.refresh()}>{m.schema_panel_resample()}</button>
    {#if v.actualSampled}<span class="muted">{m.schema_panel_sampled_docs({ count: v.actualSampled })}</span>{/if}
  </div>
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}
  <table class="schema">
    <thead><tr><th>{m.schema_panel_col_field()}</th><th>{m.schema_panel_col_type()}</th><th>{m.schema_panel_col_presence()}</th><th>{m.schema_panel_col_mixed()}</th></tr></thead>
    <tbody>
      {#each v.fields as f (f.path)}
        {@const badge = bsonTypeBadge(f.type)}
        <tr>
          <td class="field">{f.path}</td>
          <td><span class="badge" style="color:{badge.color};background:{badge.bg}">{f.type}</span></td>
          <td>{formatPercent(f.presence)}</td>
          <td>{f.mixed ? m.common_yes() : ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .schemapanel { overflow: auto; height: 100%; padding: 12px 16px; font-size: 13px; }
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .bar input { width: 70px; }
  .muted { color: var(--muted); }
  table.schema { border-collapse: collapse; width: 100%; }
  table.schema th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 4px 12px 4px 0; border-bottom: 1px solid var(--cell-border); }
  table.schema td { padding: 4px 12px 4px 0; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--row-divider); }
  .field { color: var(--text-strong); }
  .badge { padding: 1px 7px; border-radius: 9px; font-size: 11px; }
  .error { background: var(--error-bg); color: var(--error); padding: 6px 10px; }
  .status { padding: 8px 0; color: var(--muted); font-size: 12px; }
</style>
