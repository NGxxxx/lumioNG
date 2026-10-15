// src/lib/stores/documentWrites.ts — insert / replace one document with command logging and an undo
// entry (used by the document tab; the grid and drawer record their own writes).
import { insertDocument, replaceDocument, fetchFullDoc, queryPage } from "../api/documents";
import { idInFilter } from "../domain/selection";
import { idJson } from "../domain/docid";
import { insertCmd, replaceCmd } from "../domain/mongosh";
import type { Doc } from "../domain/doc";
import { commandLog } from "./commandLog.svelte";
import { undo } from "./undo.svelte";
import { toast } from "./toast.svelte";
import * as m from "#lib/paraglide/messages.js";

/** Most documents one delete keeps for undo (spec §3); above it the delete is irreversible. */
export const UNDO_DELETE_CAP = 1000;

/** Full copies of the documents about to be deleted, for undo; null when over the cap or unreadable. */
export async function snapshotForUndo(sessionId: string, db: string, coll: string, ids: string[]): Promise<Doc[] | null> {
  if (ids.length === 0 || ids.length > UNDO_DELETE_CAP) return null;
  try {
    const wanted = new Set(ids);
    const docs = await queryPage(sessionId, db, coll, 0, ids.length, idInFilter(ids));
    return docs.filter((d) => wanted.has(idJson(d) ?? ""));
  } catch {
    toast.push(m.undo_snapshot_failed(), "error", 6000);
    return null;
  }
}

export function recordDelete(sessionId: string, db: string, coll: string, docs: Doc[] | null) {
  if (docs && docs.length) undo.record({ kind: "delete", sessionId, db, coll, docs });
}

export async function insertWithUndo(sessionId: string, db: string, coll: string, doc: Doc): Promise<void> {
  const json = JSON.stringify(doc);
  const insertedId = await commandLog.pushTimed(insertCmd(coll, json), sessionId, () => insertDocument(sessionId, db, coll, json));
  let id: unknown = doc._id;
  try { id = JSON.parse(insertedId); } catch { /* keep the client-side _id */ }
  undo.record({ kind: "insert", sessionId, db, coll, doc: { ...doc, _id: id } as Doc });
}

/** Replaces by `_id`. The before-image is re-read from the server (the caller may hold a projected copy). */
export async function replaceWithUndo(sessionId: string, db: string, coll: string, idText: string, doc: Doc): Promise<void> {
  const before = await fetchFullDoc(sessionId, db, coll, idText).catch(() => null);
  const json = JSON.stringify(doc);
  await commandLog.pushTimed(replaceCmd(coll, idText, json), sessionId, () => replaceDocument(sessionId, db, coll, idText, json));
  if (before) undo.record({ kind: "replace", sessionId, db, coll, before, after: doc });
}
