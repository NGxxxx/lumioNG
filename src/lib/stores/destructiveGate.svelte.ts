// src/lib/stores/destructiveGate.svelte.ts — one pending destructive operation: fetches the real
// count, picks the confirmation level from the environment policy, then runs on confirm.
import { errorMessage } from "../api/errors";
import { confirmLevel, type DestructiveOp } from "../domain/confirmPolicy";
import type { Environment } from "../domain/environment";

export const COUNT_TIMEOUT_MS = 5000;

export type DestructiveTarget = {
  db: string; coll?: string; index?: string;
  /** killOp: the operation id (typed to confirm on PROD). */
  opid?: string;
  /** Several collections at once (database page bulk actions). */
  colls?: string[];
  /** Extra line, e.g. `_id = …`. */ detail?: string;
};
export type CountResult = { count: number; bytes?: number | null; collections?: number | null };

export type PendingDestructive = {
  op: DestructiveOp;
  target: DestructiveTarget;
  count: number | null;
  bytes: number | null;
  collections: number | null;
  counting: boolean;
  countFailed: boolean;
  level: "confirm" | "type";
  undoable: boolean;
  env: Environment;
};

export type DestructiveRequest = {
  op: DestructiveOp;
  target: DestructiveTarget;
  /** Already-known count (e.g. a selection). */
  count?: number | null;
  /** Fetches the count (timed out after 5 s → treated as unknown). */
  fetchCount?: () => Promise<number | CountResult>;
  undoable?: boolean;
  /** Always require typing the name (e.g. an empty filter = every document). */
  forceType?: boolean;
  /** The caller's own UI already was the confirmation: run at once unless typing is required. */
  skipConfirm?: boolean;
  /** Overrides the gate's environment (a gate shared by several sessions, e.g. the sidebar). */
  env?: Environment;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("count timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function createDestructiveGate(environment: () => Environment) {
  let pending = $state<PendingDestructive | null>(null);
  let running = $state(false);
  let error = $state<string | null>(null);
  let action: (() => Promise<void> | void) | null = null;
  let seq = 0;
  // Bumped per request / cancel, so the dialog can reset its type-to-confirm text.
  let requestSeq = $state(0);

  function levelFor(req: DestructiveRequest, env: Environment, count: number | null, failed: boolean): "confirm" | "type" {
    if (req.forceType || failed) return "type";
    const l = confirmLevel(env, req.op, count);
    return l === "type" ? "type" : "confirm";
  }

  async function request(req: DestructiveRequest, run: () => Promise<void> | void): Promise<void> {
    const my = ++seq;
    requestSeq = my;
    const env = req.env ?? environment();
    error = null;
    action = run;
    const known = req.count ?? null;
    pending = {
      op: req.op, target: req.target, count: known, bytes: null, collections: null,
      counting: !!req.fetchCount, countFailed: false,
      level: levelFor(req, env, known, false), undoable: req.undoable ?? false, env,
    };
    let count = known;
    let bytes: number | null = null;
    let collections: number | null = null;
    let failed = false;
    if (req.fetchCount) {
      try {
        const r = await withTimeout(req.fetchCount(), COUNT_TIMEOUT_MS);
        if (typeof r === "number") count = r;
        else { count = r.count; bytes = r.bytes ?? null; collections = r.collections ?? null; }
      } catch {
        failed = true;
        count = null;
      }
      if (my !== seq || pending === null) return;
    }
    const level = levelFor(req, env, count, failed);
    if (req.skipConfirm && level === "confirm") {
      pending = null;
      action = null;
      await run();
      return;
    }
    pending = { ...pending, count, bytes, collections, counting: false, countFailed: failed, level };
  }

  async function confirm(): Promise<void> {
    const p = pending;
    const run = action;
    if (!p || p.counting || running || !run) return;
    running = true;
    error = null;
    try {
      await run();
      if (pending === p) { pending = null; action = null; }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      running = false;
    }
  }

  function cancel() {
    if (running) return;
    requestSeq = ++seq;
    pending = null;
    action = null;
    error = null;
  }

  return {
    get pending() { return pending; },
    get running() { return running; },
    get error() { return error; },
    /** Changes with every new request (not when its count arrives). */
    get seq() { return requestSeq; },
    request,
    confirm,
    cancel,
  };
}

export type DestructiveGate = ReturnType<typeof createDestructiveGate>;
