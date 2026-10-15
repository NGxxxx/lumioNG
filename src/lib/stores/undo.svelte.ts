// src/lib/stores/undo.svelte.ts — app-wide undo stack for edits, inserts and selection deletes
// (spec §3). Each write records an entry and offers "Undo" in a toast; undo re-reads the document
// first and never overwrites someone else's change without asking.
import { fetchFullDoc, replaceDocument, updateOne, insertDocument, deleteDocument } from "../api/documents";
import { errorMessage } from "../api/errors";
import { hasConflict, inverseUpdate, describeUndo, type UndoEntry } from "../domain/undo";
import { replaceCmd, updateOneCmd, insertCmd, deleteOneCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { toast } from "./toast.svelte";
import type { Doc } from "../domain/doc";
import { msgCount } from "#lib/msgkey.js";
import * as m from "#lib/paraglide/messages.js";

export const UNDO_CAP = 20;
const TOAST_MS = 10_000;

type NewEntry = UndoEntry extends infer E ? (E extends UndoEntry ? Omit<E, "id" | "at"> : never) : never;
export type UndoResult = "ok" | "conflict" | "partial" | "failed" | "empty";

function label(e: UndoEntry): string {
  const d = describeUndo(e);
  return msgCount(d.key, d.count, d.path !== undefined ? { path: d.path } : {});
}

function idOf(e: UndoEntry): string | null {
  if (e.kind === "cell") return e.idJson;
  if (e.kind === "replace") return e.after._id === undefined ? null : JSON.stringify(e.after._id);
  if (e.kind === "insert") return e.doc._id === undefined ? null : JSON.stringify(e.doc._id);
  return null;
}

export function createUndo() {
  let entries = $state.raw<UndoEntry[]>([]);
  let conflict = $state.raw<UndoEntry | null>(null);
  let changed = $state.raw<{ sessionId: string; db: string; coll: string; ids: string[]; seq: number } | null>(null);
  let busy = $state(false);
  let nextId = 1;
  let seq = 0;

  /** Adds an entry (newest first, capped) and shows "<what happened> · Undo" for 10 s. */
  function record(e: NewEntry): number {
    const entry = { ...e, id: nextId++, at: Date.now() } as UndoEntry;
    entries = [entry, ...entries].slice(0, UNDO_CAP);
    toast.push(label(entry), "success", TOAST_MS, { label: m.undo_action(), run: () => void undo(entry.id) });
    return entry.id;
  }

  function remove(id: number) {
    entries = entries.filter((x) => x.id !== id);
  }

  function markChanged(e: UndoEntry) {
    const ids = e.kind === "delete"
      ? e.docs.flatMap((d) => (d._id === undefined ? [] : [JSON.stringify(d._id)]))
      : [idOf(e)].filter((x): x is string => x !== null);
    changed = { sessionId: e.sessionId, db: e.db, coll: e.coll, ids, seq: ++seq };
  }

  /** Writes the inverse of `e` (no conflict check). */
  async function apply(e: UndoEntry): Promise<UndoResult> {
    const { sessionId, db, coll } = e;
    switch (e.kind) {
      case "replace": {
        const id = idOf(e)!;
        const json = JSON.stringify(e.before);
        await commandLog.pushTimed(replaceCmd(coll, id, json), sessionId, () => replaceDocument(sessionId, db, coll, id, json));
        return "ok";
      }
      case "cell": {
        const filter = `{"_id": ${e.idJson}}`;
        const update = inverseUpdate(e);
        const r = await commandLog.pushTimed(updateOneCmd(coll, filter, update), sessionId, () => updateOne(sessionId, db, coll, filter, update, false));
        if (r.matched === 0) throw new Error(m.undo_gone());
        return "ok";
      }
      case "insert": {
        const id = idOf(e)!;
        await commandLog.pushTimed(deleteOneCmd(coll, id), sessionId, () => deleteDocument(sessionId, db, coll, id));
        return "ok";
      }
      case "delete": {
        let restored = 0;
        let duplicates = 0;
        const retry: Doc[] = [];
        for (const d of e.docs) {
          const json = JSON.stringify(d);
          try {
            await commandLog.pushTimed(insertCmd(coll, json), sessionId, () => insertDocument(sessionId, db, coll, json));
            restored++;
          } catch (err) {
            // A re-created _id can never be restored; anything else (offline, read-only…) can be retried.
            if (/E11000|duplicate key/i.test(errorMessage(err))) duplicates++;
            else retry.push(d);
          }
        }
        const total = e.docs.length;
        if (retry.length > 0) {
          // Keep the copies that couldn't be written: they are the only ones left.
          entries = entries.map((x) => (x.id === e.id ? ({ ...x, docs: retry } as UndoEntry) : x));
          toast.push(m.undo_failed_restore({ restored: String(restored), total: String(total), failed: String(retry.length) }), "error", 8000);
          return restored === 0 ? "failed" : "partial";
        }
        if (restored === total) {
          toast.push(msgCount("undo_restored", total));
          return "ok";
        }
        toast.push(m.undo_partial({ restored: String(restored), total: String(total), failed: String(duplicates) }), "error", 6000);
        return "partial";
      }
    }
  }

  /** Undoes one entry. Edits and inserts re-read the document first: if it changed since, nothing is
   *  written and `conflict` asks the user (confirmOverwrite / cancelOverwrite). */
  async function undo(id: number): Promise<UndoResult> {
    const e = entries.find((x) => x.id === id);
    if (!e) {
      toast.push(m.undo_expired());
      return "empty";
    }
    if (busy) {
      toast.push(m.undo_busy());
      return "failed";
    }
    busy = true;
    try {
      if (e.kind !== "delete") {
        const docId = idOf(e);
        const current = docId === null ? null : await fetchFullDoc(e.sessionId, e.db, e.coll, docId);
        if (e.kind === "insert" && current === null) {
          // Already gone: nothing left to undo.
          remove(e.id);
          toast.push(m.undo_gone());
          return "ok";
        }
        if (hasConflict(e, current)) {
          conflict = e;
          return "conflict";
        }
      }
      const r = await apply(e);
      // A delete that left documents to retry replaced its entry with them; otherwise it's done.
      if (entries.find((x) => x.id === e.id) === e) remove(e.id);
      markChanged(e);
      if (e.kind !== "delete") toast.push(m.undo_done());
      return r;
    } catch (err) {
      toast.push(errorMessage(err), "error", 6000);
      return "failed";
    } finally {
      busy = false;
    }
  }

  async function undoLast(): Promise<UndoResult> {
    const e = entries[0];
    if (!e) {
      toast.push(m.undo_nothing());
      return "empty";
    }
    return undo(e.id);
  }

  /** After a conflict: write the earlier version anyway. */
  async function confirmOverwrite(): Promise<void> {
    const e = conflict;
    conflict = null;
    if (!e) return;
    busy = true;
    try {
      await apply(e);
      remove(e.id);
      markChanged(e);
      toast.push(m.undo_done());
    } catch (err) {
      toast.push(errorMessage(err), "error", 6000);
    } finally {
      busy = false;
    }
  }

  function cancelOverwrite() {
    conflict = null;
  }

  return {
    get entries() { return entries; },
    get conflict() { return conflict; },
    /** Last namespace an undo wrote to (views of it reload). */
    get changed() { return changed; },
    get busy() { return busy; },
    record,
    undo,
    undoLast,
    confirmOverwrite,
    cancelOverwrite,
  };
}

/** App-wide singleton. */
export const undo = createUndo();
