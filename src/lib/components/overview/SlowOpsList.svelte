<!-- src/lib/components/overview/SlowOpsList.svelte — ops running longer than the chosen threshold, with Kill. Rendering only. -->
<script lang="ts">
  import type { SlowOp } from "../../domain/serverMetrics";
  import { SLOW_THRESHOLDS, type SlowThreshold } from "../../stores/overviewPoller.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { ops, threshold, onthreshold, onkill }: {
    ops: SlowOp[];
    threshold: SlowThreshold;
    onthreshold: (t: SlowThreshold) => void;
    /** Absent on read-only sessions: no Kill buttons. */
    onkill?: (op: SlowOp) => void;
  } = $props();
</script>

<section class="panel" aria-label={m.overview_slow_title()}>
  <header>
    <h3>{m.overview_slow_title()}</h3>
    <div class="seg" role="radiogroup" aria-label={m.overview_slow_threshold()}>
      <span class="hint">{m.overview_slow_threshold()}</span>
      {#each SLOW_THRESHOLDS as t (t)}
        <button role="radio" aria-checked={threshold === t} class:on={threshold === t} onclick={() => onthreshold(t)}>{t}s</button>
      {/each}
    </div>
  </header>
  {#if ops.length === 0}
    <div class="empty">{m.overview_slow_empty({ secs: String(threshold) })}</div>
  {:else}
    <ul>
      {#each ops as o (o.opid)}
        <li>
          <span class="secs">{o.secs}s</span>
          <span class="op">{o.op}</span>
          <code class="ns" title={o.ns}>{o.ns || "—"}</code>
          <span class="who" title={o.client}>{o.appName || o.client || "—"}</span>
          {#if onkill}<button class="kill" onclick={() => onkill(o)}>{m.current_ops_kill()}</button>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel { min-width: 0; padding: 0.75rem 0.875rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
  h3 { margin: 0; font-size: var(--fs); font-weight: 600; }
  .seg { display: inline-flex; align-items: center; gap: 0.125rem; }
  .hint { color: var(--muted); font-size: 0.6875rem; margin-right: 0.25rem; }
  .seg button { border: none; background: none; padding: 0.125rem 0.375rem; border-radius: var(--radius-sm); color: var(--muted); font-size: 0.6875rem; cursor: pointer; }
  .seg button.on { background: var(--menu-hover); color: var(--fg); }
  .empty { color: var(--muted); font-size: 0.75rem; padding: 0.5rem 0; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.125rem; }
  li { display: grid; grid-template-columns: 3rem 4.5rem minmax(0, 1fr) minmax(0, 8rem) auto; align-items: center; gap: 0.5rem; padding: 0.25rem 0.375rem; border-radius: var(--radius-sm); font-size: 0.75rem; }
  li:hover { background: var(--hover); }
  .secs { font-variant-numeric: tabular-nums; color: var(--warn-fg); font-weight: 600; }
  .op { color: var(--muted); }
  .ns, .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ns { font-family: var(--mono); }
  .who { color: var(--muted); }
  .kill { height: 1.25rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--panel); color: var(--error); font-size: 0.6875rem; cursor: pointer; }
  .kill:hover { background: var(--error-bg); }
</style>
