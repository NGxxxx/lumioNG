<!-- src/lib/components/DbIndexCheckPanel.svelte — results of the on-demand database-wide index check. Rendering only. -->
<script lang="ts">
  import type { DbIndexCheck } from "../stores/dbIndexCheck.svelte";
  import { describeKeys } from "../domain/indexes";
  import { formatBytes, formatCount } from "../domain/stats";
  import { msgCount, msgKey } from "#lib/msgkey.js";
  import { LOW_CONFIDENCE_DAYS } from "../domain/indexUsage";
  import * as m from "#lib/paraglide/messages.js";

  let { check, onopen, onclose }: { check: DbIndexCheck; onopen: (coll: string) => void; onclose: () => void } = $props();
</script>

<section class="dbidx" aria-label={m.dbidx_title()}>
  <header>
    <h3>{m.dbidx_title()}</h3>
    {#if check.running}
      <span class="progress" role="status">{m.dbidx_progress({ done: String(check.done), total: String(check.total) })}</span>
      <button onclick={check.cancel}>{m.dbidx_cancel()}</button>
    {:else}
      <button onclick={onclose}>{m.dbidx_close()}</button>
    {/if}
  </header>
  {#if check.minDays !== null && check.minDays < LOW_CONFIDENCE_DAYS}
    <div class="note">{msgCount("index_low_confidence", check.minDays)}</div>
  {/if}
  {#if !check.running && check.rows.length === 0}
    <div class="empty">{m.dbidx_none()}</div>
  {:else if check.rows.length > 0}
    <table>
      <thead>
        <tr><th>{m.db_collections_col_collection()}</th><th>{m.index_panel_col_name()}</th><th>{m.index_panel_col_keys()}</th><th class="num">{m.index_col_size()}</th><th class="num">{m.index_col_uses()}</th><th>{m.index_col_status()}</th></tr>
      </thead>
      <tbody>
        {#each check.rows as r (`${r.coll}|${r.info.name}`)}
          <tr onclick={() => onopen(r.coll)} title={m.dbidx_open_hint()}>
            <td><button class="link" onclick={(e) => { e.stopPropagation(); onopen(r.coll); }}>{r.coll}</button></td>
            <td>{r.info.name}</td>
            <td class="keys">{describeKeys(r.info.entries)}</td>
            <td class="num">{formatBytes(r.size)}</td>
            <td class="num">{r.usage ? formatCount(r.usage.ops) : "—"}</td>
            <td class="status">{msgKey(`index_status_${r.status}`)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if check.failed.length}<div class="failed">{m.dbidx_failed({ names: check.failed.join(", ") })}</div>{/if}
</section>

<style>
  .dbidx { margin-bottom: 0.75rem; padding: 0.625rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); }
  header { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.375rem; }
  h3 { margin: 0; font-size: var(--fs); font-weight: 600; flex: 1; }
  .progress { color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  header button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .note { margin-bottom: 0.375rem; padding: 0.3125rem 0.5rem; border-radius: var(--radius); color: var(--warn-fg); background: color-mix(in srgb, var(--warn) 10%, transparent); font-size: 0.75rem; }
  .empty, .failed { color: var(--muted); font-size: 0.75rem; padding: 0.25rem 0; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.75rem 0.25rem 0; border-bottom: 1px solid var(--cell-border); }
  td { padding: 0.25rem 0.75rem 0.25rem 0; border-bottom: 1px solid var(--row-divider); }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--hover); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .keys { font-family: var(--mono); }
  .status { color: var(--warn-fg); }
  .link { border: none; background: none; padding: 0; color: var(--link); cursor: pointer; font: inherit; }
</style>
