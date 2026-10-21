<!-- src/lib/components/DatabaseDiagram.svelte — relationship diagram of one database: hand-drawn SVG, draggable
     collection nodes, clickable reference edges. Rendering and DOM glue only; state lives in dbDiagram. -->
<script lang="ts">
  import type { DbDiagram } from "../stores/dbDiagram.svelte";
  import { buildSvg, diagramBounds, edgeGeometry } from "../domain/diagramLayout";
  import { toast } from "../stores/toast.svelte";
  import { errorMessage } from "../api/errors";
  import * as m from "#lib/paraglide/messages.js";

  let { diagram, db, onopenfilter, onclose }: {
    diagram: DbDiagram;
    db: string;
    /** Opens `coll` on its Data view with this filter text. */
    onopenfilter: (coll: string, filter: string) => void;
    onclose: () => void;
  } = $props();

  let selectedId = $state<string | null>(null);
  const selected = $derived(diagram.edges.find((e) => e.id === selectedId) ?? null);
  const byName = $derived(new Map(diagram.nodes.map((n) => [n.name, n])));
  const bounds = $derived(diagramBounds(diagram.nodes));
  const geoms = $derived(
    diagram.edges.flatMap((e) => {
      const a = byName.get(e.from);
      const b = byName.get(e.to);
      return a && b ? [{ e, g: edgeGeometry(a, b) }] : [];
    }),
  );

  // Dragging a node: pointer capture on the node, positions go to the store.
  let drag: { name: string; dx: number; dy: number } | null = null;
  function down(ev: PointerEvent, name: string) {
    const n = byName.get(name);
    if (!n) return;
    drag = { name, dx: ev.clientX - n.x, dy: ev.clientY - n.y };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  function move(ev: PointerEvent) {
    if (drag) diagram.moveNode(drag.name, ev.clientX - drag.dx, ev.clientY - drag.dy);
  }
  function up() {
    drag = null;
  }
  function nodeKey(ev: KeyboardEvent, name: string) {
    const n = byName.get(name);
    const step = ev.shiftKey ? 40 : 10;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!n || !d[ev.key]) return;
    ev.preventDefault();
    diagram.moveNode(name, n.x + d[ev.key][0], n.y + d[ev.key][1]);
  }

  function edgeKey(ev: KeyboardEvent, id: string) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      selectedId = id;
    }
  }

  async function exportSvg() {
    try {
      await diagram.exportSvg();
    } catch (e) {
      toast.push(m.dbdiag_export_failed({ message: errorMessage(e) }), "error");
    }
  }

  async function exportPng() {
    let url: string | null = null;
    try {
      const { w, h } = diagramBounds(diagram.nodes);
      const scale = 2;
      url = URL.createObjectURL(new Blob([buildSvg(diagram.nodes, diagram.edges)], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image"));
        img.src = url!;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("png");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await diagram.savePng(btoa(bin));
    } catch (e) {
      toast.push(m.dbdiag_export_failed({ message: errorMessage(e) }), "error");
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
</script>

<section class="diagram" aria-label={m.dbdiag_title({ db })}>
  <header>
    <h3>{m.dbdiag_title({ db })}</h3>
    {#if diagram.running}
      <span class="progress" role="status">{m.dbdiag_progress({ done: String(diagram.done), total: String(diagram.total) })}</span>
      <button onclick={diagram.cancel}>{m.dbdiag_cancel()}</button>
    {:else}
      <button onclick={() => void diagram.start()}>{diagram.finished ? m.dbdiag_reanalyze() : m.dbdiag_analyze()}</button>
      {#if diagram.finished && diagram.nodes.length > 0}
        <button onclick={exportSvg}>{m.dbdiag_export_svg()}</button>
        <button onclick={exportPng}>{m.dbdiag_export_png()}</button>
      {/if}
      <button onclick={onclose}>{m.dbdiag_close()}</button>
    {/if}
  </header>
  {#if diagram.error}<div class="note err" role="alert">{diagram.error}</div>{/if}
  {#if diagram.truncated}<div class="note">{m.dbdiag_truncated({ max: "50" })}</div>{/if}
  {#if diagram.failed.length}<div class="note">{m.dbdiag_failed({ names: diagram.failed.join(", ") })}</div>{/if}
  {#if diagram.finished}
    {#if diagram.edges.length === 0}
      <div class="empty">{m.dbdiag_none()}</div>
    {:else}
      <div class="hint">{m.dbdiag_hint()}</div>
    {/if}
  {/if}

  {#if selected}
    <div class="detail" role="group" aria-label={m.dbdiag_edge_title({ from: selected.from, path: selected.path, to: selected.to })}>
      <strong>{m.dbdiag_edge_title({ from: selected.from, path: selected.path, to: selected.to })}</strong>
      <span>{selected.many ? m.dbdiag_one_to_many() : m.dbdiag_one_to_one()}</span>
      <span>{m.dbdiag_score({ percent: String(Math.round(selected.score * 100)), hits: String(selected.hits), sampled: String(selected.sampled) })}</span>
      <button onclick={() => onopenfilter(selected.to, diagram.filterFor(selected.id) ?? "{}")}>{m.dbdiag_open_filter({ coll: selected.to })}</button>
      {#if selected.confirmed}
        <span class="ok">{m.dbdiag_confirmed()}</span>
      {:else}
        <button onclick={() => diagram.confirm(selected.id)}>{m.dbdiag_confirm()}</button>
      {/if}
      <button onclick={() => { diagram.remove(selected.id); selectedId = null; }}>{m.dbdiag_remove()}</button>
      <button onclick={() => (selectedId = null)}>{m.dbdiag_dismiss()}</button>
    </div>
  {/if}

  {#if diagram.nodes.length > 0}
    <div class="canvas">
      <svg width={bounds.w} height={bounds.h} viewBox={`0 0 ${bounds.w} ${bounds.h}`} role="group" aria-label={m.dbdiag_canvas_aria()}
        onpointermove={move} onpointerup={up} onpointercancel={up}>
        <defs>
          <marker id="dbdiag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead" />
          </marker>
        </defs>
        {#each geoms as { e, g } (e.id)}
          <g class="edge" class:sel={e.id === selectedId} class:guess={!e.confirmed} role="button" tabindex="0"
            aria-label={m.dbdiag_edge_aria({ from: e.from, path: e.path, to: e.to })}
            onclick={() => (selectedId = e.id)} onkeydown={(ev) => edgeKey(ev, e.id)}>
            <path d={g.d} class="hit" />
            <path d={g.d} class="line" marker-end="url(#dbdiag-arrow)" />
            <text x={g.mid.x} y={g.mid.y - 4} text-anchor="middle">{e.path}{e.many ? " [ ]" : ""}</text>
          </g>
        {/each}
        {#each diagram.nodes as n (n.name)}
          <g class="node" role="button" tabindex="0" aria-label={m.dbdiag_node_aria({ name: n.name })}
            onpointerdown={(ev) => down(ev, n.name)} onkeydown={(ev) => nodeKey(ev, n.name)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="6" class="box" />
            <rect x={n.x} y={n.y} width={n.w} height="28" rx="6" class="head" />
            <text x={n.x + 10} y={n.y + 18} class="name">{n.name}</text>
            {#each n.fields.slice(0, 6) as f, i (f)}
              <text x={n.x + 10} y={n.y + 41 + i * 17} class="field">{f}</text>
            {/each}
            {#if n.fields.length > 6}<text x={n.x + 10} y={n.y + 41 + 6 * 17} class="field">+{n.fields.length - 6}</text>{/if}
          </g>
        {/each}
      </svg>
    </div>
  {/if}

  {#if diagram.removed.length > 0}
    <details class="removed">
      <summary>{m.dbdiag_removed({ count: String(diagram.removed.length) })}</summary>
      <ul>
        {#each diagram.removed as e (e.id)}
          <li>{m.dbdiag_edge_title({ from: e.from, path: e.path, to: e.to })} <button onclick={() => diagram.restore(e.id)}>{m.dbdiag_restore()}</button></li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<style>
  .diagram { margin-bottom: 0.75rem; padding: 0.625rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); }
  header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; }
  h3 { margin: 0; font-size: var(--fs); font-weight: 600; flex: 1; }
  .progress { color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .note, .hint, .empty { color: var(--muted); font-size: 0.75rem; padding: 0.25rem 0; }
  .err { color: var(--danger, var(--warn-fg)); }
  .detail { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.375rem 0; padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); font-size: 0.75rem; }
  .ok { color: var(--muted); }
  .canvas { overflow: auto; max-height: 70vh; border: 1px solid var(--row-divider); border-radius: var(--radius); }
  svg { display: block; touch-action: none; }
  .arrowhead { fill: var(--muted); }
  .edge { cursor: pointer; }
  .edge .hit { fill: none; stroke: transparent; stroke-width: 14; }
  .edge .line { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .edge.guess .line { stroke-dasharray: 5 4; }
  .edge.sel .line, .edge:focus-visible .line, .edge:hover .line { stroke: var(--link); stroke-width: 2.25; }
  .edge text { fill: var(--muted); font-size: 10px; pointer-events: none; }
  .edge:focus-visible, .node:focus-visible { outline: none; }
  .node { cursor: grab; }
  .node:focus-visible .box { stroke: var(--link); stroke-width: 2; }
  .box { fill: var(--panel); stroke: var(--border); }
  .head { fill: var(--hover); }
  .name { font-weight: 600; font-size: 12px; fill: var(--fg); }
  .field { font-size: 11px; fill: var(--muted); }
  .removed { margin-top: 0.375rem; font-size: 0.75rem; }
</style>
