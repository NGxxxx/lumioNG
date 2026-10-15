<!-- src/lib/components/overview/Sparkline.svelte — one series as a thin line; `null` points are gaps (pause / restart), never bridged. Hover shows the nearest value. -->
<script lang="ts">
  import type { Point } from "../../domain/serverMetrics";

  let { points, label, format }: { points: Point[]; label: string; format: (v: number) => string } = $props();

  const W = 120;
  const H = 32;
  const PAD = 3;

  const real = $derived(points.filter((p): p is { at: number; v: number } => p !== null));
  // Scale to the series' own range so the trend is visible, but never narrower than 10% of its
  // level: a flat-but-noisy series must not look like it is swinging wildly.
  const lo = $derived(real.length ? Math.min(...real.map((p) => p.v)) : 0);
  const hi = $derived(real.length ? Math.max(...real.map((p) => p.v)) : 1);
  const span = $derived(Math.max(hi - lo, Math.abs(hi) * 0.1, 1));
  const base = $derived(lo - (span - (hi - lo)) / 2);
  const x = (i: number) => (points.length <= 1 ? W : (i / (points.length - 1)) * W);
  const y = (v: number) => H - PAD - ((v - base) / span) * (H - 2 * PAD);

  // Consecutive non-null runs → one polyline each.
  const runs = $derived.by(() => {
    const out: string[] = [];
    let cur: string[] = [];
    points.forEach((p, i) => {
      if (p === null) {
        if (cur.length) out.push(cur.join(" "));
        cur = [];
      } else cur.push(`${x(i).toFixed(1)},${y(p.v).toFixed(1)}`);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  });

  let hover = $state<number | null>(null);
  const hovered = $derived(hover !== null ? points[hover] ?? null : null);

  function onmove(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (r.width === 0 || points.length === 0) return;
    hover = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
  }
</script>

<div class="spark">
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label={label}
    onpointermove={onmove} onpointerleave={() => (hover = null)}>
    {#each runs as r, i (i)}
      <polyline points={r} />
    {/each}
    {#if runs.length === 1 && !runs[0].includes(" ")}
      <!-- a single sample: a dot instead of an invisible zero-length line -->
      <circle cx={W} cy={y(real[0].v)} r="2" class="dot" />
    {/if}
    {#if hovered && hover !== null}
      <line class="cross" x1={x(hover)} x2={x(hover)} y1="0" y2={H} />
      <circle cx={x(hover)} cy={y(hovered.v)} r="2.5" class="dot" />
    {/if}
  </svg>
  {#if hovered}<span class="tip">{format(hovered.v)}</span>{/if}
</div>

<style>
  .spark { position: relative; height: 2.25rem; margin-top: auto; }
  svg { width: 100%; height: 100%; display: block; overflow: visible; }
  polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .cross { stroke: var(--muted); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.5; }
  .dot { fill: var(--accent); stroke: var(--panel); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .tip {
    position: absolute; top: -1.375rem; right: 0; padding: 0.0625rem 0.375rem; border-radius: var(--radius-sm);
    background: var(--popover); box-shadow: var(--shadow-sm); color: var(--fg); font-size: 0.6875rem; white-space: nowrap; pointer-events: none;
  }
</style>
