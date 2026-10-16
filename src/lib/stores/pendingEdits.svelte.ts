import { updateOne } from "../api/documents";
import { errorMessage } from "../api/errors";
import { buildSetUpdate } from "../domain/celledit";
import { updateOneCmd } from "../domain/mongosh";
import { stageEdit, type PendingEdit } from "../domain/pendingEdits";
import { commandLog } from "./commandLog.svelte";
import { undo } from "./undo.svelte";
import { toast } from "./toast.svelte";
import { msgCount } from "#lib/msgkey.js";

export interface CommitResult {
  committed: number;
  /** Edits dropped because their document no longer exists. */
  missing: number;
  /** Set when a write failed: that edit and every later one stay pending. */
  error: string | null;
}

const nsKey = (sessionId: string, db: string, coll: string) => `${sessionId}\u0000${db}\u0000${coll}`;

/** Cell edits staged for review, per namespace. Lives outside the collection views so switching
 *  pages, refreshing or leaving the collection never loses them. */
function createPendingEdits() {
  let byNs = $state.raw<Record<string, PendingEdit[]>>({});
  let committing = $state.raw<ReadonlySet<string>>(new Set());

  const list = (sessionId: string, db: string, coll: string) => byNs[nsKey(sessionId, db, coll)] ?? [];

  function set(k: string, next: PendingEdit[]) {
    const { [k]: _, ...rest } = byNs;
    byNs = next.length ? { ...rest, [k]: next } : rest;
  }

  function stage(sessionId: string, db: string, coll: string, edit: PendingEdit) {
    const k = nsKey(sessionId, db, coll);
    set(k, stageEdit(byNs[k] ?? [], edit));
  }

  function discard(sessionId: string, db: string, coll: string) {
    set(nsKey(sessionId, db, coll), []);
  }

  /** Writes the edits in order, one `$set` per cell — the same write an immediate edit makes. */
  async function commit(sessionId: string, db: string, coll: string): Promise<CommitResult> {
    const k = nsKey(sessionId, db, coll);
    const result: CommitResult = { committed: 0, missing: 0, error: null };
    if (committing.has(k)) return result;
    committing = new Set([...committing, k]);
    try {
      for (const p of byNs[k] ?? []) {
        const filter = `{"_id": ${p.idJson}}`;
        const update = buildSetUpdate(p.path, p.after);
        try {
          const res = await commandLog.pushTimed(updateOneCmd(coll, filter, update), sessionId, () =>
            updateOne(sessionId, db, coll, filter, update, false));
          if (res.matched === 0) result.missing++;
          else {
            undo.record({ kind: "cell", sessionId, db, coll, idJson: p.idJson, path: p.path, before: p.before, after: p.after }, { toast: false });
            result.committed++;
          }
          set(k, (byNs[k] ?? []).filter((x) => x !== p));
        } catch (e) {
          result.error = errorMessage(e);
          break;
        }
      }
    } finally {
      committing = new Set([...committing].filter((x) => x !== k));
    }
    if (result.committed) toast.push(msgCount("pending_committed", result.committed), "success");
    if (result.missing) toast.push(msgCount("pending_missing", result.missing), "error");
    return result;
  }

  function dropSession(sessionId: string) {
    const prefix = `${sessionId}\u0000`;
    byNs = Object.fromEntries(Object.entries(byNs).filter(([k]) => !k.startsWith(prefix)));
  }

  return {
    list,
    stage,
    discard,
    commit,
    dropSession,
    isCommitting: (sessionId: string, db: string, coll: string) => committing.has(nsKey(sessionId, db, coll)),
    /** Pending edits across every namespace of one session (or all sessions). */
    count(sessionId?: string): number {
      const prefix = sessionId === undefined ? "" : `${sessionId}\u0000`;
      return Object.entries(byNs).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v.length : n), 0);
    },
  };
}

export const pendingEdits = createPendingEdits();
