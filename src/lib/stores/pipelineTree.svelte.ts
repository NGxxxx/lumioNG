import { aggregate } from "../api/documents";
import { createDebouncer } from "../domain/timing";
import {
  parsePipelineFromScript, stagesToScript, defaultStageBody, newStageId, type StageEntry,
} from "../domain/pipelineStages";
import type { Doc } from "../domain/doc";
import { createAsyncGuard } from "./asyncGuard.svelte";
import { settings } from "./settings.svelte";

export interface PreviewState {
  docs: Doc[];
  loading: boolean;
  error: string | null;
  hasRun: boolean;
}

const EMPTY_PREVIEW: PreviewState = { docs: [], loading: false, error: null, hasRun: false };

export interface ScriptBinding {
  get: () => string;
  set: (script: string) => void;
}

const PREVIEW_DEBOUNCE_MS = 450;
const PREVIEW_SAMPLE_SIZE = 20;

/** Stage operators that write to a collection instead of just shaping the output — previewing a
 *  pipeline that reaches one of these would silently execute the write, so it's blocked client-side. */
const WRITE_STAGES = new Set(["$out", "$merge"]);

/** Per-Query-tab store backing the "Tree" sub-tab: keeps a stage list synced with the tab's
 *  script text (via `script`), plus a debounced live preview per stage. */
export function createPipelineTree(sessionId: string, script: ScriptBinding) {
  let stages = $state.raw<StageEntry[]>([]);
  let coll = $state("");
  let parseError = $state<string | null>(null);
  let autoPreview = $state(false);
  let previews = $state.raw<Record<string, PreviewState>>({});

  let lastSyncedScript: string | null = null;
  let selfGeneratedScript: string | null = null;
  const debouncers = new Map<string, ReturnType<typeof createDebouncer>>();

  // Matches TreeEditor.svelte's own ROWS_DEBOUNCE_MS: `updateStageBody` fires on every keystroke
  // from TreeLeafInput (no debounce of its own there — it's a shared component other callers rely
  // on committing synchronously, e.g. DocumentForm's Save reads the just-typed value immediately).
  // Debouncing HERE instead — the full-pipeline JSON.stringify + script.set() is the expensive part
  // — gets the same "no regenerate() per character" outcome without changing that shared contract.
  const REGENERATE_DEBOUNCE_MS = 120;
  const regenerateDebouncer = createDebouncer(REGENERATE_DEBOUNCE_MS);

  function regenerate(): void {
    const text = stagesToScript(coll, stages);
    selfGeneratedScript = text;
    lastSyncedScript = text;
    script.set(text);
  }

  /** Re-parses the bound script into `stages`, unless it's exactly what this store itself last
   *  wrote (Tree → Script direction) or hasn't changed since the last sync — so switching back to
   *  Tree right after an edit doesn't discard in-progress view state for no reason. */
  function syncFromScript(): void {
    const current = script.get();
    if (current === selfGeneratedScript || current === lastSyncedScript) return;
    lastSyncedScript = current;
    const result = parsePipelineFromScript(current);
    if (!result.ok) {
      parseError = "pipeline_tree_parse_error";
      return;
    }
    parseError = null;
    coll = result.coll;
    stages = result.stages;
    previews = {};
  }

  function addStage(name: string, atIndex: number): void {
    const next = stages.slice();
    next.splice(atIndex, 0, { id: newStageId(), name, body: defaultStageBody(name) });
    stages = next;
    regenerate();
  }

  /** Drops cached preview state for every stage at or after `fromIndex` in the CURRENT `stages`
   *  array — their composed pipeline changed and the old preview would be stale/wrong. */
  function invalidatePreviewsFrom(fromIndex: number): void {
    if (fromIndex < 0) return;
    const staleIds = new Set(stages.slice(fromIndex).map((s) => s.id));
    if (staleIds.size === 0) return;
    const next = { ...previews };
    for (const id of staleIds) delete next[id];
    previews = next;
  }

  function removeStage(index: number): void {
    const removed = stages[index];
    stages = stages.filter((_, i) => i !== index);
    if (removed) {
      const next = { ...previews };
      delete next[removed.id];
      previews = next;
    }
    invalidatePreviewsFrom(index);
    regenerate();
  }

  function reorderStage(from: number, to: number): void {
    if (from === to) return;
    const next = stages.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    stages = next;
    invalidatePreviewsFrom(Math.min(from, to));
    regenerate();
  }

  function renameStage(index: number, name: string): void {
    stages = stages.map((s, i) => (i === index ? { id: s.id, name, body: defaultStageBody(name) } : s));
    invalidatePreviewsFrom(index);
    regenerate();
  }

  /** Debounced regenerate: called on every keystroke (via TreeLeafInput's onchange), so the
   *  expensive full-pipeline stringify+script.set() is coalesced instead of running per character. */
  function updateStageBody(index: number, body: unknown): void {
    stages = stages.map((s, i) => (i === index ? { ...s, body } : s));
    invalidatePreviewsFrom(index);
    regenerateDebouncer.schedule(regenerate);
  }

  function setPreview(id: string, patch: Partial<PreviewState>): void {
    const current = previews[id] ?? EMPTY_PREVIEW;
    previews = { ...previews, [id]: { ...current, ...patch } };
  }

  // One asyncGuard per stage id: two edits to the same stage fired far apart can have their preview
  // responses resolve out of order; the generation token lets a stale response be discarded instead
  // of overwriting a fresher one. Created lazily, never removed (bounded by the stage count).
  const previewGuards = new Map<string, ReturnType<typeof createAsyncGuard>>();
  function guardFor(id: string): ReturnType<typeof createAsyncGuard> {
    let g = previewGuards.get(id);
    if (!g) {
      g = createAsyncGuard();
      previewGuards.set(id, g);
    }
    return g;
  }

  async function runPreview(id: string, db: string): Promise<void> {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx === -1 || !coll) return;
    const pipeline = stages.slice(0, idx + 1);
    const guard = guardFor(id);
    const gen = guard.begin();
    if (pipeline.some((s) => WRITE_STAGES.has(s.name))) {
      if (guard.isCurrent(gen)) setPreview(id, { loading: false, error: "pipeline_tree_preview_write_stage_blocked", hasRun: true });
      guard.finish(gen);
      return;
    }
    setPreview(id, { loading: true, error: null });
    try {
      const docs = await aggregate(
        sessionId, db, coll,
        JSON.stringify(pipeline.map((s) => ({ [s.name]: s.body }))),
        0, PREVIEW_SAMPLE_SIZE, settings.queryTimeoutMs,
      );
      if (guard.isCurrent(gen)) setPreview(id, { docs, loading: false, hasRun: true });
    } catch (e) {
      if (guard.isCurrent(gen)) setPreview(id, { loading: false, error: e instanceof Error ? e.message : String(e), hasRun: true });
    } finally {
      guard.finish(gen);
    }
  }

  function requestPreview(id: string, db: string): void {
    if (!autoPreview) return;
    let d = debouncers.get(id);
    if (!d) {
      d = createDebouncer(PREVIEW_DEBOUNCE_MS);
      debouncers.set(id, d);
    }
    d.schedule(() => void runPreview(id, db));
  }

  return {
    get stages() { return stages; },
    get coll() { return coll; },
    get parseError() { return parseError; },
    get autoPreview() { return autoPreview; },
    setAutoPreview(v: boolean) { autoPreview = v; },
    syncFromScript,
    addStage,
    removeStage,
    reorderStage,
    renameStage,
    updateStageBody,
    previewFor: (id: string) => previews[id] ?? EMPTY_PREVIEW,
    requestPreview,
    runPreview,
  };
}

export type PipelineTree = ReturnType<typeof createPipelineTree>;
