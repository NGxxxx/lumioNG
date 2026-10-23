// src/lib/stores/dbDiagram.svelte.ts — infers references between the collections of one database and
// holds the diagram (nodes, edges, user decisions). Read-only: samples documents and runs `_id $in`
// lookups, only when started; cancellable between steps.
import { listPlainCollections } from "../api/connection";
import { sampleDocuments, queryPage } from "../api/documents";
import { errorMessage } from "../api/errors";
import { saveDialog, writeTextFile, writeBase64File } from "../api/files";
import type { Doc } from "../domain/doc";
import { forEachLimit } from "../domain/concurrency";
import { idInFilter } from "../domain/selection";
import { inferSchema, type CollectionSchema } from "../domain/schema";
import { candidateRefs, collectRefValues, scoreCandidate, MIN_REF_SCORE, REF_VALUES_PER_CANDIDATE } from "../domain/refInference";
import { buildSvg, layoutGrid, type DiagramEdge, type DiagramNode } from "../domain/diagramLayout";
import { memoryKey } from "../domain/refTarget";
import { clearEdgeDecision, edgeKey, forget, getEdgeDecisions, getRemembered, remember, setEdgeDecision } from "./refMemory";

export const DIAGRAM_MAX_COLLECTIONS = 50;
export const DIAGRAM_SAMPLE_SIZE = 200;
/** Sample / lookup queries in flight at once while building the diagram. */
export const DIAGRAM_CONCURRENCY = 4;
const QUERY_TIMEOUT_MS = 15_000;

export type InferredEdge = DiagramEdge & { hits: number; sampled: number; sampleIds: string[]; removed: boolean };

export function createDbDiagram(sessionId: string, db: string, connId: number | null) {
  let running = $state(false);
  let done = $state(0);
  let total = $state(0);
  let truncated = $state(false);
  let error = $state<string | null>(null);
  let failed = $state.raw<string[]>([]);
  let edges = $state.raw<InferredEdge[]>([]);
  let nodes = $state.raw<DiagramNode[]>([]);
  let finished = $state(false);
  let gen = 0;
  const moved = new Map<string, { x: number; y: number }>();

  const visible = () => edges.filter((e) => !e.removed);

  function relayout(names: string[]) {
    nodes = layoutGrid(names, visible()).map((n) => {
      const p = moved.get(n.name);
      return p ? { ...n, ...p } : n;
    });
  }

  async function start() {
    const my = ++gen;
    running = true;
    finished = false;
    error = null;
    done = 0;
    total = 0;
    failed = [];
    edges = [];
    nodes = [];
    moved.clear();
    try {
      const listed = (await listPlainCollections(sessionId, db)).filter((c) => !c.startsWith("system."));
      if (my !== gen) return;
      truncated = listed.length > DIAGRAM_MAX_COLLECTIONS;
      const colls = listed.slice(0, DIAGRAM_MAX_COLLECTIONS);
      total = colls.length;
      const samples: Record<string, Doc[]> = {};
      const schemas: Record<string, CollectionSchema> = {};
      await forEachLimit(colls, DIAGRAM_CONCURRENCY, async (c) => {
        if (my !== gen) return;
        try {
          const docs = await sampleDocuments(sessionId, db, c, "{}", DIAGRAM_SAMPLE_SIZE, QUERY_TIMEOUT_MS);
          if (my !== gen) return;
          samples[c] = docs;
          schemas[c] = inferSchema(docs);
        } catch {
          if (my !== gen) return;
          failed = [...failed, c]; // no privilege, dropped meanwhile: the others still run
          samples[c] = [];
          schemas[c] = { sampleSize: 0, fields: [] };
        }
        done++;
      });
      if (my !== gen) return;
      const cands = candidateRefs(schemas);
      total += cands.length;
      const decisions = getEdgeDecisions(connId, db);
      const scored: InferredEdge[] = [];
      await forEachLimit(cands, DIAGRAM_CONCURRENCY, async (cand) => {
        if (my !== gen) return;
        const values = collectRefValues(samples[cand.from], cand.path, REF_VALUES_PER_CANDIDATE);
        if (values.length > 0) {
          try {
            const found = await queryPage(sessionId, db, cand.to, 0, values.length, idInFilter(values), null, '{"_id":1}', QUERY_TIMEOUT_MS);
            if (my !== gen) return;
            const hits = Math.min(found.length, values.length);
            const score = scoreCandidate(hits, values.length);
            const state = decisions[cand.id];
            if (score >= MIN_REF_SCORE || state === "confirmed") {
              scored.push({ ...cand, score, hits, sampled: values.length, sampleIds: values, confirmed: state === "confirmed", removed: state === "removed" });
            }
          } catch {
            if (my !== gen) return;
            if (!failed.includes(cand.to)) failed = [...failed, cand.to];
          }
        }
        done++;
      });
      if (my !== gen) return;
      edges = scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      relayout(colls);
      finished = true;
    } catch (e) {
      if (my === gen) error = errorMessage(e);
    } finally {
      if (my === gen) running = false;
    }
  }

  function cancel() {
    gen++;
    running = false;
  }

  function patch(id: string, p: Partial<InferredEdge>) {
    edges = edges.map((e) => (e.id === id ? { ...e, ...p } : e));
    relayoutKeepNames();
  }
  function relayoutKeepNames() {
    relayout(nodes.map((n) => n.name));
  }

  /** The user says this edge is real: kept next time even when sampling is weak; also guides the reference jump. */
  function confirm(id: string) {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    setEdgeDecision(edgeKey(connId, db, id), "confirmed");
    remember(memoryKey(connId, db, e.from, e.path), e.to);
    patch(id, { confirmed: true, removed: false });
  }

  /** The user says this edge is wrong: hidden now and on later runs until restored. */
  function remove(id: string) {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    setEdgeDecision(edgeKey(connId, db, id), "removed");
    const k = memoryKey(connId, db, e.from, e.path);
    if (getRemembered(k) === e.to) forget(k);
    patch(id, { removed: true, confirmed: false });
  }

  function restore(id: string) {
    clearEdgeDecision(edgeKey(connId, db, id));
    patch(id, { removed: false, confirmed: false });
  }

  function moveNode(name: string, x: number, y: number) {
    const pos = { x: Math.max(0, x), y: Math.max(0, y) };
    moved.set(name, pos);
    nodes = nodes.map((n) => (n.name === name ? { ...n, ...pos } : n));
  }

  /** Filter text selecting the referenced documents of an edge (the sampled values) in its target collection. */
  function filterFor(id: string): string | null {
    const e = edges.find((x) => x.id === id);
    return e ? idInFilter(e.sampleIds) : null;
  }

  /** Saves the diagram as a standalone SVG file. Returns false when the user cancels the dialog. */
  async function exportSvg(): Promise<boolean> {
    const path = await saveDialog(`${db}-diagram.svg`, [{ name: "SVG", extensions: ["svg"] }]);
    if (!path) return false;
    await writeTextFile(path, buildSvg(nodes, visible()));
    return true;
  }

  /** The standalone SVG text (the component rasterizes it for PNG). */
  function svgText(): string {
    return buildSvg(nodes, visible());
  }

  /** Saves already-rasterized PNG bytes (base64). Returns false when the user cancels the dialog. */
  async function savePng(base64: string): Promise<boolean> {
    const path = await saveDialog(`${db}-diagram.png`, [{ name: "PNG", extensions: ["png"] }]);
    if (!path) return false;
    await writeBase64File(path, base64);
    return true;
  }

  return {
    get running() { return running; },
    get finished() { return finished; },
    get done() { return done; },
    get total() { return total; },
    get truncated() { return truncated; },
    get error() { return error; },
    get failed() { return failed; },
    get nodes() { return nodes; },
    get edges() { return visible(); },
    get removed() { return edges.filter((e) => e.removed); },
    minScore: MIN_REF_SCORE,
    start,
    cancel,
    confirm,
    remove,
    restore,
    moveNode,
    filterFor,
    exportSvg,
    svgText,
    savePng,
  };
}

export type DbDiagram = ReturnType<typeof createDbDiagram>;
