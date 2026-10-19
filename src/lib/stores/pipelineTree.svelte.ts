import { aggregate } from "../api/documents";
import { createDebouncer } from "../domain/timing";
import {
  parsePipelineFromScript, stagesToScript, defaultStageBody, newStageId, type StageEntry,
} from "../domain/pipelineStages";
import type { Doc } from "../domain/doc";
import { numFromExt } from "../domain/extjson";
import { createAsyncGuard } from "./asyncGuard.svelte";
import { settings } from "./settings.svelte";
import { listIndexes } from "../api/indexes";
import { errorMessage } from "../api/errors";
import { nextSteps as nextStepsFor, expandTemplate, stageWarnings } from "../domain/stageForms";
import { inferSchema, mergeColumns } from "../domain/schema";
import { fieldInfos, indexedLeadingFields, type FieldInfo } from "../domain/fieldInfo";

/** Shared across every PipelineTree instance on purpose — copying a stage in one Query tab's
 *  Builder and pasting it into a different tab's Builder should work, so this deliberately isn't
 *  per-instance state. Not the OS clipboard: navigator.clipboard.readText() has never been used in
 *  this codebase (only writeText, for plain copy-to-clipboard elsewhere) and would need a new
 *  Tauri clipboard-read permission + cross-platform verification for a use case this already
 *  covers within a single app session. */
let clipboard = $state<{ name: string; body: unknown } | null>(null);

/** Test-only: the module-level clipboard above persists across every `it()` in a test file (it's
 *  loaded once per file), so tests that assert on clipboard state must reset it first. */
export function resetClipboardForTests(): void {
  clipboard = null;
}

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
  /** Database the tab runs against (previews / counts need it). */
  db?: () => string | null;
  /** Where the selected stage's preview goes (the tab's Result pane). */
  preview?: { show: (docs: Doc[], label: { stage: number; of: number }) => void; clear: () => void };
}

export type TemplateId = Parameters<typeof expandTemplate>[0];
export type StageCount = number | "error" | null;
const COUNT_TIMEOUT_MS = 5000;

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

  // ── Builder state (spec §1): selection drives the Result pane; every card shows its count ──
  let selectedId = $state<string | null>(null);
  let counts = $state.raw<Record<string, StageCount>>({});
  let discardedNotice = $state(0);
  let previewError = $state<string | null>(null);
  let indexCache = $state.raw<Record<string, string[] | null>>({});
  let previewSeq = 0;
  let countSeq = 0;
  const selectDebouncer = createDebouncer(PREVIEW_DEBOUNCE_MS);
  const countDebouncer = createDebouncer(PREVIEW_DEBOUNCE_MS);
  const outputs = new Map<string, Doc[]>(); // stage id → last sampled output (feeds fieldsAt)

  const enabledStages = $derived(stages.filter((s) => s.enabled !== false));
  const warnings = $derived.by(() => {
    const base = stageWarnings(
      stages.map((s) => ({ name: s.name, body: s.body, enabled: s.enabled !== false })),
      (c) => indexCache[c] ?? null,
    );
    const zero = stages.flatMap((s, index) => (counts[s.id] === 0 ? [{ index, key: "zero_docs" }] : []));
    return [...base, ...zero];
  });
  const nextSteps = $derived(nextStepsFor(enabledStages.map((s) => ({ name: s.name, body: s.body }))));

  const toPipelineJson = (list: StageEntry[]) => JSON.stringify(list.map((s) => ({ [s.name]: s.body })));
  /** Enabled stages up to and including `index`. */
  const prefixThrough = (index: number) => stages.slice(0, index + 1).filter((s) => s.enabled !== false);

  function select(id: string | null) {
    selectedId = id;
    previewSeq++;
    previewError = null;
    if (id === null) {
      selectDebouncer.cancel();
      script.preview?.clear();
      return;
    }
    selectDebouncer.schedule(() => void runSelectedPreview());
  }

  async function runSelectedPreview() {
    const my = ++previewSeq;
    const idx = stages.findIndex((s) => s.id === selectedId);
    const db = script.db?.() ?? null;
    if (idx === -1 || !db || !coll) return;
    const prefix = prefixThrough(idx);
    if (prefix.some((s) => WRITE_STAGES.has(s.name))) return;
    try {
      const docs = await aggregate(sessionId, db, coll, toPipelineJson(prefix), 0, PREVIEW_SAMPLE_SIZE, settings.queryTimeoutMs);
      if (my !== previewSeq) return;
      outputs.set(stages[idx].id, docs);
      script.preview?.show(docs, { stage: prefix.length, of: enabledStages.length });
    } catch (e) {
      if (my === previewSeq) previewError = errorMessage(e);
    }
  }

  /** Recounts every card from `from` on (debounced; superseded counts are dropped). */
  function refreshCounts(from = 0) {
    const stale: Record<string, StageCount> = { ...counts };
    for (const s of stages.slice(from)) stale[s.id] = null;
    counts = stale;
    countDebouncer.schedule(() => void runCounts(from));
  }

  async function runCounts(from: number) {
    const my = ++countSeq;
    const db = script.db?.() ?? null;
    if (!db || !coll) return;
    const timeout = Math.min(settings.queryTimeoutMs ?? COUNT_TIMEOUT_MS, COUNT_TIMEOUT_MS);
    for (let i = from; i < stages.length; i++) {
      const s = stages[i];
      if (s.enabled === false) continue;
      const prefix = prefixThrough(i);
      if (prefix.some((p) => WRITE_STAGES.has(p.name))) break; // never run a pipeline that writes
      let value: StageCount;
      try {
        const rows = await aggregate(sessionId, db, coll, JSON.stringify([...prefix.map((p) => ({ [p.name]: p.body })), { $count: "n" }]), 0, 1, timeout);
        // `$count` omits its document when nothing matched; numbers arrive as ExtJSON wrappers.
        value = numFromExt((rows[0] as { n?: unknown } | undefined)?.n) ?? 0;
      } catch {
        value = "error";
      }
      if (my !== countSeq) return;
      counts = { ...counts, [s.id]: value };
    }
  }

  /** Loads (once) the index lists the warnings need: the source collection and every $lookup target. */
  function ensureIndexes() {
    const db = script.db?.() ?? null;
    if (!db || !coll) return;
    const wanted = new Set<string>([coll]);
    for (const s of stages) {
      const from = s.name === "$lookup" ? (s.body as { from?: unknown } | null)?.from : undefined;
      if (typeof from === "string") wanted.add(from);
    }
    for (const c of wanted) {
      if (c in indexCache) continue;
      indexCache = { ...indexCache, [c]: null };
      listIndexes(sessionId, db, c)
        .then((raw) => { indexCache = { ...indexCache, [c]: [...indexedLeadingFields(raw), "_id"] }; })
        .catch(() => {});
    }
  }

  /** After any edit at `index`: stale previews/counts from there on, re-preview the selection. */
  function afterEdit(index: number) {
    previewSeq++;
    for (const s of stages.slice(Math.max(0, index))) outputs.delete(s.id);
    refreshCounts(Math.max(0, index));
    ensureIndexes();
    if (selectedId) selectDebouncer.schedule(() => void runSelectedPreview());
  }

  /** Explain advice: moves the first $match that follows a reshaping stage in front of it. */
  function moveMatchFirst() {
    const RESHAPING = new Set(["$group", "$project", "$unwind", "$addFields", "$set", "$lookup", "$replaceRoot"]);
    const reshape = stages.findIndex((s) => RESHAPING.has(s.name));
    if (reshape === -1) return;
    const match = stages.findIndex((s, i) => i > reshape && s.name === "$match");
    if (match !== -1) reorderStage(match, reshape);
  }

  function setEnabled(index: number, on: boolean) {
    stages = stages.map((s, i) => (i === index ? { ...s, enabled: on } : s));
    regenerate();
    afterEdit(index);
  }

  function applyTemplate(id: TemplateId, args: Record<string, string | number>) {
    const added = expandTemplate(id, args).map((s) => ({ id: newStageId(), name: s.name, body: s.body }));
    const at = stages.length;
    stages = [...stages, ...added];
    regenerate();
    afterEdit(at);
  }

  function addStep(stage: { name: string; body: unknown }) {
    const at = stages.length;
    stages = [...stages, { id: newStageId(), name: stage.name, body: stage.body }];
    regenerate();
    afterEdit(at);
  }

  /** Fields available as input to stage `index`: the sampled output of the stage before it, or
   *  the collection itself for the first stage. */
  async function fieldsAt(index: number): Promise<FieldInfo[]> {
    const db = script.db?.() ?? null;
    if (!db || !coll) return [];
    const prev = index > 0 ? stages[index - 1] : null;
    let docs = prev ? outputs.get(prev.id) : outputs.get("__source");
    if (!docs) {
      const prefix = index > 0 ? prefixThrough(index - 1) : [];
      if (prefix.some((s) => WRITE_STAGES.has(s.name))) return [];
      try {
        docs = await aggregate(sessionId, db, coll, toPipelineJson(prefix), 0, PREVIEW_SAMPLE_SIZE, settings.queryTimeoutMs);
      } catch {
        return [];
      }
      outputs.set(prev ? prev.id : "__source", docs);
    }
    const indexed = new Set(index === 0 ? (indexCache[coll] ?? []) : []);
    return fieldInfos(mergeColumns(inferSchema(docs), docs), indexed);
  }

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
    const disabled = stages.filter((s) => s.enabled === false).length;
    discardedNotice = disabled;
    coll = result.coll;
    stages = result.stages;
    previews = {};
    outputs.clear();
    if (selectedId && !stages.some((s) => s.id === selectedId)) select(null);
    refreshCounts(0);
    ensureIndexes();
  }

  function addStage(name: string, atIndex: number): void {
    const next = stages.slice();
    next.splice(atIndex, 0, { id: newStageId(), name, body: defaultStageBody(name) });
    stages = next;
    invalidatePreviewsFrom(atIndex);
    regenerate();
    afterEdit(atIndex);
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
    afterEdit(index);
  }

  function reorderStage(from: number, to: number): void {
    if (from === to) return;
    const next = stages.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    stages = next;
    invalidatePreviewsFrom(Math.min(from, to));
    regenerate();
    afterEdit(Math.min(from, to));
  }

  function renameStage(index: number, name: string): void {
    stages = stages.map((s, i) => (i === index ? { id: s.id, name, body: defaultStageBody(name) } : s));
    invalidatePreviewsFrom(index);
    regenerate();
    afterEdit(index);
  }

  function cutStage(index: number): void {
    const removed = stages[index];
    if (!removed) return;
    // body is shared by reference with the clipboard, not deep-cloned — safe only because every
    // mutation path here treats a stage's body as immutable (updateStageBody replaces the whole
    // object; stages is $state.raw). Don't start mutating body in place without revisiting this.
    clipboard = { name: removed.name, body: removed.body };
    removeStage(index);
  }

  function copyStage(index: number): void {
    const s = stages[index];
    if (!s) return;
    // body is shared by reference, not deep-cloned — see the invariant note in cutStage above.
    clipboard = { name: s.name, body: s.body };
  }

  function pasteStageAfter(index: number): void {
    if (!clipboard) return;
    const next = stages.slice();
    next.splice(index + 1, 0, { id: newStageId(), name: clipboard.name, body: clipboard.body });
    stages = next;
    invalidatePreviewsFrom(index + 1);
    regenerate();
    afterEdit(index + 1);
  }

  function duplicateStage(index: number): void {
    const s = stages[index];
    if (!s) return;
    const next = stages.slice();
    next.splice(index + 1, 0, { id: newStageId(), name: s.name, body: s.body });
    stages = next;
    invalidatePreviewsFrom(index + 1);
    regenerate();
    afterEdit(index + 1);
  }

  /** Debounced regenerate: called on every keystroke (via TreeLeafInput's onchange), so the
   *  expensive full-pipeline stringify+script.set() is coalesced instead of running per character. */
  function updateStageBody(index: number, body: unknown): void {
    stages = stages.map((s, i) => (i === index ? { ...s, body } : s));
    invalidatePreviewsFrom(index);
    regenerateDebouncer.schedule(regenerate);
    afterEdit(index);
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

  /** Retargets live preview requests to a different session — called alongside the query script's
   *  own `rebindSession` when the user confirms a session switch for this tab (see QueryTab.svelte). */
  function rebindSession(newSessionId: string): void {
    sessionId = newSessionId;
  }

  return {
    get stages() { return stages; },
    get selectedId() { return selectedId; },
    select,
    get counts() { return counts; },
    refreshCounts,
    get warnings() { return warnings; },
    get nextSteps() { return nextSteps; },
    addStep,
    applyTemplate,
    setEnabled,
    moveMatchFirst,
    fieldsAt,
    get previewError() { return previewError; },
    /** Disabled stages dropped by a direct script edit (0 = nothing to say). */
    get discardedNotice() { return discardedNotice; },
    dismissDiscardedNotice() { discardedNotice = 0; },
    get coll() { return coll; },
    get sessionId() { return sessionId; },
    rebindSession,
    get parseError() { return parseError; },
    get autoPreview() { return autoPreview; },
    setAutoPreview(v: boolean) { autoPreview = v; },
    syncFromScript,
    addStage,
    removeStage,
    reorderStage,
    renameStage,
    cutStage,
    copyStage,
    pasteStageAfter,
    duplicateStage,
    get hasClipboard() { return clipboard !== null; },
    updateStageBody,
    previewFor: (id: string) => previews[id] ?? EMPTY_PREVIEW,
    requestPreview,
    runPreview,
  };
}

export type PipelineTree = ReturnType<typeof createPipelineTree>;
