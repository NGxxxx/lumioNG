<!-- src/lib/components/overview/MetricTile.svelte — one headline number with its trend (stat tile). Rendering only. -->
<script lang="ts">
  import Sparkline from "./Sparkline.svelte";
  import type { Point } from "../../domain/serverMetrics";
  import * as m from "#lib/paraglide/messages.js";

  let {
    label, value, sub = null, title, points, format, meter = null, dim = false, denied = false,
  }: {
    label: string;
    value: string;
    sub?: string | null;
    /** Tooltip with the breakdown behind the number. */
    title?: string;
    points: Point[];
    format: (v: number) => string;
    /** 0..1 share of a limit, drawn as a track under the value. */
    meter?: number | null;
    dim?: boolean;
    denied?: boolean;
  } = $props();
</script>

<section class="tile" class:dim aria-label={label}>
  <div class="label">{label}</div>
  {#if denied}
    <div class="denied">{m.overview_not_permitted()}</div>
  {:else}
    <div class="value" {title}>{value}</div>
    {#if sub}<div class="sub">{sub}</div>{/if}
    {#if meter !== null}
      <div class="meter" class:warn={meter >= 0.8}><span style="width:{Math.min(100, Math.round(meter * 100))}%"></span></div>
    {/if}
    <Sparkline {points} {format} label={m.overview_chart_label({ name: label, count: String(points.length) })} />
  {/if}
</section>

<style>
  .tile { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; padding: 0.75rem 0.875rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); transition: opacity 0.2s; }
  .tile.dim { opacity: 0.55; }
  .label { color: var(--muted); font-size: 0.6875rem; }
  .value { font-size: 1.375rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { color: var(--muted); font-size: 0.6875rem; }
  .denied { color: var(--muted); font-size: 0.75rem; padding: 0.5rem 0; }
  .meter { height: 0.25rem; border-radius: 0.125rem; background: color-mix(in srgb, var(--accent) 18%, transparent); overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: 0.125rem; background: var(--accent); }
  .meter.warn { background: color-mix(in srgb, var(--warn) 22%, transparent); }
  .meter.warn span { background: var(--warn); }
</style>
