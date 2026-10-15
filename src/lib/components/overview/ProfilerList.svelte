<!-- src/lib/components/overview/ProfilerList.svelte — finished slow queries from system.profile, or how to turn the profiler on. Never enables it. -->
<script lang="ts">
  import { parseProfileEntry } from "../../domain/serverMetrics";
  import type { ProfilerView } from "../../stores/overviewPoller.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { profiler, oncopy }: { profiler: ProfilerView; oncopy: (text: string) => void } = $props();

  const SNIPPET = "db.setProfilingLevel(1, { slowms: 100 })";
  const entries = $derived(profiler.entries.map(parseProfileEntry).filter((e) => e !== null));
  const time = (ts: number) => (ts ? new Date(ts).toLocaleTimeString() : "—");
</script>

<section class="panel" aria-label={m.overview_profiler_title()}>
  <header><h3>{m.overview_profiler_title()}</h3></header>
  {#if profiler.enabled.length === 0}
    <p class="off">{m.overview_profiler_off()}</p>
    <p class="hint">{m.overview_profiler_hint()}</p>
    <div class="snippet"><code>{SNIPPET}</code><button onclick={() => oncopy(SNIPPET)}>{m.overview_profiler_copy()}</button></div>
  {:else if entries.length === 0}
    <div class="empty">{m.overview_profiler_empty()}</div>
  {:else}
    <ul>
      {#each entries as e, i (i)}
        <li>
          <span class="ms">{e.millis} ms</span>
          <span class="op">{e.op}</span>
          <code class="ns" title={e.ns}>{e.ns}</code>
          <span class="plan">{e.plan}</span>
          <span class="at">{time(e.ts)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel { min-width: 0; padding: 0.75rem 0.875rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); }
  header { margin-bottom: 0.5rem; }
  h3 { margin: 0; font-size: var(--fs); font-weight: 600; }
  .off { margin: 0.25rem 0; font-size: 0.75rem; color: var(--fg); }
  .hint, .empty { margin: 0.25rem 0; font-size: 0.75rem; color: var(--muted); }
  .snippet { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; border-radius: var(--radius); background: var(--bg); }
  .snippet code { flex: 1; font-family: var(--mono); font-size: 0.75rem; overflow-x: auto; white-space: nowrap; }
  .snippet button { height: 1.5rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: 0.6875rem; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.125rem; max-height: 16rem; overflow: auto; }
  li { display: grid; grid-template-columns: 4.5rem 4.5rem minmax(0, 1fr) minmax(0, 7rem) auto; align-items: center; gap: 0.5rem; padding: 0.25rem 0.375rem; border-radius: var(--radius-sm); font-size: 0.75rem; }
  li:hover { background: var(--hover); }
  .ms { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--warn-fg); }
  .op, .plan, .at { color: var(--muted); }
  .ns, .plan { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ns { font-family: var(--mono); }
</style>
