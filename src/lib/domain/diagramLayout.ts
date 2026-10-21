/** Geometry and static SVG output for the database relationship diagram. Pure. */

export type DiagramEdge = { id: string; from: string; path: string; to: string; many: boolean; score: number; confirmed: boolean };
export type DiagramNode = { name: string; x: number; y: number; w: number; h: number; fields: string[] };

export const NODE_W = 190;
const HEAD_H = 28;
const ROW_H = 17;
const MAX_FIELD_ROWS = 6;
const GAP_X = 70;
const GAP_Y = 50;
const PAD = 24;

function nodeHeight(fields: number): number {
  const shown = Math.min(fields, MAX_FIELD_ROWS + 1);
  return HEAD_H + shown * ROW_H + 8;
}

/** Grid layout: collections with the most edges first, filling rows left to right. */
export function layoutGrid(collections: string[], edges: DiagramEdge[]): DiagramNode[] {
  const degree = new Map<string, number>(collections.map((c) => [c, 0]));
  const fields = new Map<string, string[]>(collections.map((c) => [c, []]));
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    if (e.to !== e.from) degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    const list = fields.get(e.from);
    if (list && !list.includes(e.path)) list.push(e.path);
  }
  const order = [...collections].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
  const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
  const nodes: DiagramNode[] = [];
  let y = PAD;
  for (let r = 0; r * cols < order.length; r++) {
    const row = order.slice(r * cols, (r + 1) * cols);
    const hs = row.map((c) => nodeHeight(fields.get(c)!.length));
    row.forEach((name, i) => {
      nodes.push({ name, x: PAD + i * (NODE_W + GAP_X), y, w: NODE_W, h: hs[i], fields: fields.get(name)! });
    });
    y += Math.max(...hs) + GAP_Y;
  }
  return nodes;
}

export type EdgeGeometry = { d: string; mid: { x: number; y: number }; end: { x: number; y: number; angle: number } };

/** Curve from the source node to the target node, leaving/entering on the sides that face each other. */
export function edgeGeometry(a: DiagramNode, b: DiagramNode): EdgeGeometry {
  if (a.name === b.name) {
    const x = a.x + a.w;
    const y1 = a.y + 14;
    const y2 = a.y + 34;
    return { d: `M ${x} ${y1} C ${x + 40} ${y1 - 8} ${x + 40} ${y2 + 8} ${x} ${y2}`, mid: { x: x + 30, y: (y1 + y2) / 2 }, end: { x, y: y2, angle: 180 } };
  }
  const acx = a.x + a.w / 2;
  const bcx = b.x + b.w / 2;
  const overlapX = Math.abs(acx - bcx) < (a.w + b.w) / 2;
  let sx: number, sy: number, ex: number, ey: number, c1x: number, c1y: number, c2x: number, c2y: number, angle: number;
  if (overlapX) {
    const down = b.y >= a.y;
    sx = acx; ex = bcx;
    sy = down ? a.y + a.h : a.y;
    ey = down ? b.y : b.y + b.h;
    const k = Math.max(30, Math.abs(ey - sy) / 2);
    c1x = sx; c2x = ex;
    c1y = sy + (down ? k : -k);
    c2y = ey + (down ? -k : k);
    angle = down ? 90 : -90;
  } else {
    const right = bcx > acx;
    sx = right ? a.x + a.w : a.x;
    ex = right ? b.x : b.x + b.w;
    sy = a.y + a.h / 2;
    ey = b.y + b.h / 2;
    const k = Math.max(30, Math.abs(ex - sx) / 2);
    c1y = sy; c2y = ey;
    c1x = sx + (right ? k : -k);
    c2x = ex + (right ? -k : k);
    angle = right ? 0 : 180;
  }
  const mid = { x: (sx + 3 * c1x + 3 * c2x + ex) / 8, y: (sy + 3 * c1y + 3 * c2y + ey) / 8 };
  return { d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`, mid, end: { x: ex, y: ey, angle } };
}

export function diagramBounds(nodes: DiagramNode[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const n of nodes) {
    w = Math.max(w, n.x + n.w + 60);
    h = Math.max(h, n.y + n.h);
  }
  return { w: w + PAD, h: h + PAD };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Standalone SVG document (fixed light palette, no CSS variables) for export. */
export function buildSvg(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const { w, h } = diagramBounds(nodes);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif" font-size="12">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
  ];
  for (const e of edges) {
    const a = byName.get(e.from);
    const b = byName.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeometry(a, b);
    const dash = e.confirmed ? "" : ` stroke-dasharray="5 4"`;
    parts.push(`<path d="${g.d}" fill="none" stroke="#64748b" stroke-width="1.5"${dash} marker-end="url(#arrow)"/>`);
    parts.push(`<text x="${g.mid.x}" y="${g.mid.y - 4}" text-anchor="middle" fill="#475569" font-size="10">${esc(e.path)}${e.many ? " [ ]" : ""}</text>`);
  }
  for (const n of nodes) {
    parts.push(`<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="#f8fafc" stroke="#94a3b8"/>`);
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${HEAD_H}" rx="6" fill="#e2e8f0"/>`);
    parts.push(`<text x="${n.x + 10}" y="${n.y + 18}" font-weight="600" fill="#0f172a">${esc(n.name)}</text>`);
    n.fields.slice(0, MAX_FIELD_ROWS).forEach((f, i) => {
      parts.push(`<text x="${n.x + 10}" y="${n.y + HEAD_H + 13 + i * ROW_H}" fill="#475569">${esc(f)}</text>`);
    });
    if (n.fields.length > MAX_FIELD_ROWS) {
      parts.push(`<text x="${n.x + 10}" y="${n.y + HEAD_H + 13 + MAX_FIELD_ROWS * ROW_H}" fill="#94a3b8">+${n.fields.length - MAX_FIELD_ROWS}</text>`);
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}
