import { startWatch, stopWatch, type WatchMessage, type WatchStart, type WatchTarget } from "../api/watch";
import { fetchFullDoc } from "../api/documents";
import { writeTextFile } from "../api/files";
import { errorMessage, rawErrorText } from "../api/errors";
import {
  toChangeEvent, KnownDocs, matchesFilter, trimEvents, documentPipeline, exportEvents, docKey,
  CHANGE_OPS, type ChangeEvent, type ChangeOp,
} from "../domain/changeEvents";
import { watchCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { pickSavePath } from "./desktop";

/** Recording keeps at most this many events / characters of event JSON; older ones drop off. */
export const WATCH_MAX_EVENTS = 10_000;
export const WATCH_MAX_CHARS = 64_000_000;

export type WatchStatus = "starting" | "recording" | "paused" | "standalone" | "error" | "ended";

export interface WatchScope {
  db: string | null;
  coll: string | null;
  /** Watch a single document (Canonical ExtJSON of its _id); needs `db` and `coll`. */
  idText?: string | null;
}

export interface WatchDeps {
  start: (sessionId: string, watchId: string, target: WatchTarget, onMessage: (m: WatchMessage) => void) => Promise<WatchStart>;
  stop: (sessionId: string, watchId: string) => Promise<void>;
  fetchDoc: (sessionId: string, db: string, coll: string, idText: string) => Promise<Record<string, unknown> | null>;
  now: () => number;
}

const defaultDeps: WatchDeps = { start: startWatch, stop: stopWatch, fetchDoc: fetchFullDoc, now: Date.now };

let watchSeq = 0;

const isDenied = (raw: string) => /\bUnauthorized\b|\(code 13\)/.test(raw);

/** One Watch tab: records change events only while it is open and not paused. */
export function createWatch(sessionId: string, scope: WatchScope, deps: WatchDeps = defaultDeps) {
  let status = $state<WatchStatus>("starting");
  let error = $state<string | null>(null);
  // The user lacks the changeStream/find privilege: explained in the UI rather than shown raw.
  let denied = $state(false);
  let preImages = $state<boolean | null>(null);
  // Plain event objects, replaced as a whole on every batch (never deep-proxied).
  let events = $state.raw<ChangeEvent[]>([]);
  let dropped = $state(0);
  let ops = $state.raw<ReadonlySet<ChangeOp>>(new Set(CHANGE_OPS));
  let text = $state("");
  let selectedSeq = $state<number | null>(null);
  let recordingSince = $state<number | null>(null);

  const known = new KnownDocs();
  let seq = 0;
  let watchId: string | null = null;
  let disposed = false;

  const pipeline = scope.idText ? documentPipeline(scope.idText) : null;

  const counts = $derived.by(() => {
    const c: Record<ChangeOp, number> = { insert: 0, update: 0, replace: 0, delete: 0, other: 0 };
    for (const e of events) c[e.op] += 1;
    return c;
  });
  const visible = $derived(
    ops.size === CHANGE_OPS.length && !text.trim() ? events : events.filter((e) => matchesFilter(e, { ops, text })),
  );
  const selected = $derived(selectedSeq === null ? null : (events.find((e) => e.seq === selectedSeq) ?? null));
  /** Every recorded event of the selected event's document, oldest first. */
  const history = $derived.by(() => {
    const s = selected;
    if (!s || s.idText === null) return [];
    const k = docKey(s.ns, s.idText);
    return events.filter((e) => e.idText !== null && docKey(e.ns, e.idText) === k);
  });

  function onMessage(id: string, m: WatchMessage) {
    if (id !== watchId) return; // a late batch from a stream already stopped
    if (m.type === "events") {
      const at = deps.now();
      const batch = m.events.map((raw, i) => toChangeEvent(raw, ++seq, at, m.sizes[i] ?? 0, known));
      const next = trimEvents([...events, ...batch], WATCH_MAX_EVENTS, WATCH_MAX_CHARS);
      dropped += events.length + batch.length - next.length;
      events = next;
      if (selectedSeq !== null && next[0] && selectedSeq < next[0].seq) selectedSeq = null;
    } else if (m.type === "error") {
      watchId = null;
      status = "error";
      error = m.message;
      denied = isDenied(m.message);
    } else {
      watchId = null;
      status = "ended";
    }
  }

  async function seedBaseline() {
    if (!scope.idText || !scope.db || !scope.coll) return;
    const doc = await deps.fetchDoc(sessionId, scope.db, scope.coll, scope.idText).catch(() => null);
    if (doc) known.set(docKey(`${scope.db}.${scope.coll}`, scope.idText), doc);
  }

  async function start() {
    if (disposed || status === "recording") return;
    status = "starting";
    error = null;
    denied = false;
    // Changes made while paused were not seen, so earlier states can no longer serve as "before".
    known.clear();
    await seedBaseline();
    const id = `w${++watchSeq}`;
    watchId = id;
    const startedAt = deps.now();
    try {
      const res = await deps.start(sessionId, id, { db: scope.db, coll: scope.coll, pipeline }, (m) => onMessage(id, m));
      if (watchId !== id) {
        // Paused or closed while the stream was opening: it registered after our stop, so stop it now.
        if (res.status === "started") void deps.stop(sessionId, id).catch(() => {});
        return;
      }
      if (res.status === "standalone") {
        watchId = null;
        status = "standalone";
        return;
      }
      preImages = res.preImages;
      status = "recording";
      recordingSince = deps.now();
      commandLog.push(watchCmd({ db: scope.db !== null, coll: scope.coll, pipeline }), sessionId, recordingSince - startedAt);
    } catch (e) {
      if (watchId !== id) return;
      watchId = null;
      status = "error";
      error = errorMessage(e);
      denied = isDenied(rawErrorText(e));
    }
  }

  function halt() {
    const id = watchId;
    watchId = null;
    if (id) void deps.stop(sessionId, id).catch(() => {});
  }

  function pause() {
    if (status !== "recording" && status !== "starting") return;
    halt();
    status = "paused";
    recordingSince = null;
  }

  function toggle() {
    if (status === "recording" || status === "starting") pause();
    else void start();
  }

  function clear() {
    events = [];
    dropped = 0;
    selectedSeq = null;
  }

  function dispose() {
    disposed = true;
    halt();
  }

  function toggleOp(op: ChangeOp) {
    const next = new Set(ops);
    if (next.has(op)) next.delete(op);
    else next.add(op);
    ops = next;
  }

  /** Shows only `op`; when it is already the only one shown, shows every operation again. */
  function soloOp(op: ChangeOp) {
    ops = ops.size === 1 && ops.has(op) ? new Set(CHANGE_OPS) : new Set([op]);
  }

  /** The event's document as it is in the database now (null when gone or not a document event). */
  async function currentDocument(e: ChangeEvent): Promise<Record<string, unknown> | null> {
    const dot = e.ns.indexOf(".");
    if (e.idText === null || dot < 0) return null;
    return await deps.fetchDoc(sessionId, e.ns.slice(0, dot), e.ns.slice(dot + 1), e.idText);
  }

  async function exportToFile(): Promise<string | null> {
    const base = scope.coll ?? scope.db ?? "deployment";
    const path = await pickSavePath(`${base}-changes.json`, "json");
    if (!path) return null;
    await writeTextFile(path, exportEvents(events));
    return path;
  }

  return {
    get scope() { return scope; },
    get status() { return status; },
    get error() { return error; },
    get denied() { return denied; },
    get preImages() { return preImages; },
    get events() { return events; },
    get visible() { return visible; },
    get dropped() { return dropped; },
    get counts() { return counts; },
    get ops() { return ops; },
    get text() { return text; },
    set text(v: string) { text = v; },
    get selected() { return selected; },
    get history() { return history; },
    get recordingSince() { return recordingSince; },
    select(s: number | null) { selectedSeq = s; },
    start,
    pause,
    toggle,
    clear,
    dispose,
    toggleOp,
    soloOp,
    exportToFile,
    currentDocument,
  };
}

export type Watch = ReturnType<typeof createWatch>;
