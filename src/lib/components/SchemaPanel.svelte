<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionSchema } from "../stores/collectionSchema.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { bsonTypeBadge } from "../domain/theme";
  import { formatPercent } from "../domain/stats";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();
  const v = untrack(() => createCollectionSchema(sessionManager.active?.id ?? "", db, coll));
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
  .schemapanel { overflow: auto; height: 100%; padding: 0.75rem 1rem; font-size: 0.8125rem; }
  .bar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.625rem; }
  .bar input { width: 4.375rem; }
  .muted { color: var(--muted); }
  table.schema { border-collapse: collapse; width: 100%; user-select: none; }
  table.schema th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.75rem 0.25rem 0; border-bottom: 1px solid var(--cell-border); }
  table.schema td { padding: 0.25rem 0.75rem 0.25rem 0; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--row-divider); }
  .field { color: var(--text-strong); }
  .badge { padding: 0.0625rem 0.4375rem; border-radius: 0.5625rem; font-size: 0.6875rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .status { padding: 0.5rem 0; color: var(--muted); font-size: 0.75rem; }
</style>
