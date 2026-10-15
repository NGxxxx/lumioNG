<!-- src/lib/components/overview/OverviewDashboard.svelte — Host → Overview: health sentence, four live tiles, slow ops and profiler lists. Polls only while mounted AND the window is visible. -->
<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import { sessionManager } from "../../stores/sessionManager.svelte";
  import { sessionEnvironment, sessionMeta } from "../../stores/sessionEnv";
  import { createOverviewPoller, OVERVIEW_INTERVALS } from "../../stores/overviewPoller.svelte";
  import { createClipboardCopy } from "../../stores/clipboardCopy";
  import { toast } from "../../stores/toast.svelte";
  import { healthSummary } from "../../domain/serverHealth";
  import { formatBytes, formatCount } from "../../domain/stats";
  import { formatUptime } from "../../domain/host";
  import { maskUri } from "../../domain/uri";
  import { msgCount, msgKey } from "#lib/msgkey.js";
  import MetricTile from "./MetricTile.svelte";
  import SlowOpsList from "./SlowOpsList.svelte";
  import ProfilerList from "./ProfilerList.svelte";
  import DestructiveDialog from "../DestructiveDialog.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { connection, details }: { connection: { label: string; uri: string } | null; details?: Snippet } = $props();

  const sessionId = untrack(() => sessionManager.active?.id ?? "");
  const p = untrack(() =>
    createOverviewPoller(sessionId, { prod: sessionEnvironment(sessionId) === "prod", connId: sessionMeta(sessionId).connId }),
  );
  const readOnly = $derived(sessionManager.active?.readOnly ?? false);
  const info = $derived(sessionManager.active?.host?.info ?? null);
  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));

  onMount(() => {
    const sync = () => (document.visibilityState === "hidden" ? p.stop() : p.start());
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      p.stop();
    };
  });

  const health = $derived(
    healthSummary({
      rates: p.rates, sample: p.latest, slowOps: p.slowOps, thresholdSecs: p.threshold,
      permitted: p.permitted, stale: p.stale, retryInSecs: p.retryInSecs,
    }),
  );
  const healthText = $derived.by(() => {
    const prm = { ...health.params };
    if (health.key === "health_slow_ops") return msgCount(health.key, Number(prm.count), prm);
    if (/^\d+$/.test(prm.ops ?? "")) prm.ops = formatCount(Number(prm.ops));
    return msgKey(health.key, prm);
  });

  const s = $derived(p.latest);
  const r = $derived(p.rates);
  const limit = $derived(s ? s.connCurrent + s.connAvailable : 0);
  const connShare = $derived(s && limit > 0 ? s.connCurrent / limit : null);
  const rate = (v: number) => formatCount(Math.round(v));
  const bytesPerSec = (v: number) => `${formatBytes(Math.round(v))}/s`;
  const mb = (v: number) => formatBytes(Math.round(v * 1024 * 1024));
  const opsTitle = $derived(r ? Object.entries(r.byKind).map(([k, v]) => `${k}: ${rate(v)}`).join("\n") : undefined);
  const intervalLabel = (ms: number) => `${ms / 1000}s`;

</script>

<div class="overview">
  <header class="top">
    <div class="who">
      <div class="title">{connection?.label ?? "—"}</div>
      <div class="sub">{connection?.uri ? maskUri(connection.uri) : "—"}</div>
    </div>
    <div class="interval" role="radiogroup" aria-label={m.overview_refresh()}>
      <span class="hint">{m.overview_refresh()}</span>
      {#each OVERVIEW_INTERVALS as ms (ms)}
        <button role="radio" aria-checked={p.intervalMs === ms} class:on={p.intervalMs === ms} onclick={() => p.setIntervalMs(ms)}>{intervalLabel(ms)}</button>
      {/each}
      <button role="radio" aria-checked={p.intervalMs === null} class:on={p.intervalMs === null} onclick={() => p.setIntervalMs(null)}>{m.overview_pause()}</button>
    </div>
  </header>

  <div class="health {health.tone}" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="sentence">{health.tone === "ok" ? "" : "⚠ "}{healthText}{p.intervalMs === null ? ` · ${m.overview_paused()}` : ""}</span>
    <span class="facts">
      {[s?.version ?? info?.version, info?.storageEngine, s?.host ?? info?.hostname, s ? m.overview_uptime({ uptime: formatUptime(s.uptime) }) : null].filter(Boolean).join(" · ")}
    </span>
  </div>

  <div class="tiles">
    <MetricTile label={m.overview_tile_ops()} value={r ? rate(r.ops) : "—"} title={opsTitle} points={p.series.ops} format={rate} dim={p.stale} denied={!p.permitted} />
    <MetricTile label={m.overview_tile_conns()} value={s ? formatCount(s.connCurrent) : "—"}
      sub={s && connShare !== null ? m.overview_conns_sub({ limit: formatCount(limit), pct: String(Math.round(connShare * 100)) }) : null}
      meter={connShare} points={p.series.conns} format={rate} dim={p.stale} denied={!p.permitted} />
    <MetricTile label={m.overview_tile_net()} value={r ? bytesPerSec(r.netInPerSec + r.netOutPerSec) : "—"}
      sub={r ? m.overview_net_value({ in: formatBytes(Math.round(r.netInPerSec)), out: formatBytes(Math.round(r.netOutPerSec)) }) : null}
      points={p.series.net} format={bytesPerSec} dim={p.stale} denied={!p.permitted} />
    <MetricTile label={m.overview_tile_mem()} value={s?.memResidentMb != null ? mb(s.memResidentMb) : "—"} points={p.series.mem} format={mb} dim={p.stale} denied={!p.permitted} />
  </div>

  <div class="lists">
    <SlowOpsList ops={p.slowOps} threshold={p.threshold} onthreshold={p.setThreshold} onkill={readOnly ? undefined : p.requestKill} />
    {#if p.profiler}<ProfilerList profiler={p.profiler} oncopy={copy} />{/if}
  </div>

  {#if details}
    <details class="details">
      <summary>{m.overview_details()}</summary>
      {@render details()}
    </details>
  {/if}
</div>

<DestructiveDialog gate={p.destructive} />

<style>
  .overview { height: 100%; box-sizing: border-box; overflow: auto; background: var(--bg); padding: 0.875rem 1.125rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .title { font-size: 0.875rem; font-weight: 600; }
  .sub { color: var(--muted); font-size: 0.75rem; }
  .interval { display: inline-flex; align-items: center; gap: 0.125rem; padding: 0.125rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); }
  .interval .hint { color: var(--muted); font-size: 0.6875rem; margin: 0 0.375rem 0 0.25rem; }
  .interval button { border: none; background: none; padding: 0.125rem 0.5rem; border-radius: var(--radius-sm); color: var(--muted); font-size: 0.75rem; cursor: pointer; }
  .interval button.on { background: var(--menu-hover); color: var(--fg); }
  .health { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); font-size: var(--fs); }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ok-strong, var(--accent)); flex: none; }
  .health.warn .dot { background: var(--warn); }
  .health.error .dot { background: var(--error); }
  .health.warn .sentence { color: var(--warn-fg); }
  .health.error .sentence { color: var(--error); }
  .sentence { font-weight: 500; }
  .facts { margin-left: auto; color: var(--muted); font-size: 0.75rem; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.625rem; }
  .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: 0.625rem; align-items: start; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: 0.75rem; }
  .details summary { cursor: pointer; color: var(--muted); font-size: 0.75rem; }
</style>
