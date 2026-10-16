import { startProfileWatch, stopWatch, type ProfileStart, type WatchMessage } from "../api/watch";
import { errorMessage } from "../api/errors";
import { writeTextFile } from "../api/files";
import { trimEvents } from "../domain/changeEvents";
import { toQueryEntry, matchesQueryFilter, QUERY_KINDS, type QueryEntry, type QueryKind } from "../domain/profileEntries";
import { setProfilingLevelCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { pickSavePath } from "./desktop";
import { WATCH_MAX_EVENTS, WATCH_MAX_CHARS } from "./watch.svelte";

export type QueryWatchStatus = "idle" | "starting" | "recording" | "paused" | "unavailable" | "error";
/** Why the profiler can't be used here; each case gets its own explanation in the UI. */
export type Unavailable =
  | { reason: "deployment" }
  | { reason: "mongos" }
  | { reason: "readOnly" }
  | { reason: "denied"; message: string }
  | { reason: "unsupported"; message: string };

/** "all" records every operation (profiler level 2); "slow" only those slower than `slowms` (level 1). */
export type CaptureMode = "all" | "slow";

export interface QueryWatchDeps {
  start: typeof startProfileWatch;
  stop: (sessionId: string, watchId: string) => Promise<void>;
  now: () => number;
}

const defaultDeps: QueryWatchDeps = { start: startProfileWatch, stop: stopWatch, now: Date.now };

let seqId = 0;

/** The Watch tab's Query mode: follows the database profiler while recording. Nothing is turned on
 *  until the user starts it; pausing or closing puts the previous profiler setting back. */
export function createQueryWatch(sessionId: string, scope: { db: string | null; coll: string | null }, deps: QueryWatchDeps = defaultDeps) {
  let status = $state<QueryWatchStatus>(scope.db ? "idle" : "unavailable");
  let unavailable = $state.raw<Unavailable | null>(scope.db ? null : { reason: "deployment" });
  let error = $state<string | null>(null);
  let capture = $state<CaptureMode>("all");
  let slowms = $state(100);
  let previousLevel = $state<number | null>(null);
  let entries = $state.raw<QueryEntry[]>([]);
  let dropped = $state(0);
  let kinds = $state.raw<ReadonlySet<QueryKind>>(new Set(QUERY_KINDS));
  let needsIndex = $state(false);
  let text = $state("");
  let selectedSeq = $state<number | null>(null);

  let seq = 0;
  let watchId: string | null = null;
  let disposed = false;

  const counts = $derived.by(() => {
    const c: Record<QueryKind, number> = { read: 0, write: 0, other: 0 };
    for (const e of entries) c[e.kind] += 1;
    return c;
  });
  const visible = $derived(
    kinds.size === QUERY_KINDS.length && !needsIndex && !text.trim()
      ? entries
      : entries.filter((e) => matchesQueryFilter(e, { kinds, needsIndex, text })),
  );
  const selected = $derived(selectedSeq === null ? null : (entries.find((e) => e.seq === selectedSeq) ?? null));

  function onMessage(id: string, m: WatchMessage) {
    if (id !== watchId) return;
    if (m.type === "events") {
      const at = deps.now();
      const batch = m.events.map((raw, i) => toQueryEntry(raw, ++seq, at, m.sizes[i] ?? 0));
      const next = trimEvents([...entries, ...batch], WATCH_MAX_EVENTS, WATCH_MAX_CHARS);
      dropped += entries.length + batch.length - next.length;
      entries = next;
      if (selectedSeq !== null && next[0] && selectedSeq < next[0].seq) selectedSeq = null;
    } else {
      watchId = null;
      status = "error";
      error = m.type === "error" ? m.message : null;
    }
  }

  function unavailableFrom(r: Exclude<ProfileStart, { status: "started" }>): Unavailable {
    return r.status === "denied" || r.status === "unsupported" ? { reason: r.status, message: r.message } : { reason: r.status };
  }

  async function start() {
    if (disposed || !scope.db || status === "recording" || status === "starting") return;
    status = "starting";
    error = null;
    const id = `q${++seqId}`;
    watchId = id;
    const level = capture === "all" ? 2 : 1;
    const t0 = deps.now();
    try {
      const res = await deps.start(sessionId, id, { db: scope.db, coll: scope.coll, level, slowms }, (m) => onMessage(id, m));
      if (watchId !== id) {
        if (res.status === "started") void deps.stop(sessionId, id).catch(() => {});
        return;
      }
      if (res.status !== "started") {
        watchId = null;
        status = "unavailable";
        unavailable = unavailableFrom(res);
        return;
      }
      previousLevel = res.previousLevel;
      status = "recording";
      commandLog.push(setProfilingLevelCmd(level, slowms), sessionId, deps.now() - t0);
    } catch (e) {
      if (watchId !== id) return;
      watchId = null;
      status = "error";
      error = errorMessage(e);
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
  }

  function toggle() {
    if (status === "recording" || status === "starting") pause();
    else void start();
  }

  function clear() {
    entries = [];
    dropped = 0;
    selectedSeq = null;
  }

  function dispose() {
    disposed = true;
    halt();
  }

  function toggleKind(k: QueryKind) {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    kinds = next;
  }

  function soloKind(k: QueryKind) {
    kinds = kinds.size === 1 && kinds.has(k) ? new Set(QUERY_KINDS) : new Set([k]);
  }

  async function exportToFile(): Promise<string | null> {
    const path = await pickSavePath(`${scope.coll ?? scope.db ?? "queries"}-profile.json`, "json");
    if (!path) return null;
    await writeTextFile(path, `[\n${entries.map((e) => JSON.stringify(e.raw)).join(",\n")}\n]\n`);
    return path;
  }

  return {
    get status() { return status; },
    get unavailable() { return unavailable; },
    get error() { return error; },
    get capture() { return capture; },
    set capture(v: CaptureMode) { capture = v; },
    get slowms() { return slowms; },
    set slowms(v: number) { slowms = Math.max(0, Math.round(Number.isFinite(v) ? v : 0)); },
    get previousLevel() { return previousLevel; },
    get entries() { return entries; },
    get visible() { return visible; },
    get dropped() { return dropped; },
    get counts() { return counts; },
    get kinds() { return kinds; },
    get needsIndex() { return needsIndex; },
    set needsIndex(v: boolean) { needsIndex = v; },
    get text() { return text; },
    set text(v: string) { text = v; },
    get selected() { return selected; },
    select(s: number | null) { selectedSeq = s; },
    start,
    pause,
    toggle,
    clear,
    dispose,
    toggleKind,
    soloKind,
    exportToFile,
  };
}

export type QueryWatch = ReturnType<typeof createQueryWatch>;
