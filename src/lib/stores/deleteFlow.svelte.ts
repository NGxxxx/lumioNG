import * as m from "#lib/paraglide/messages.js";
import { deleteDocument, deleteMany } from "../api/documents";
import { errorMessage } from "../api/errors";
import { idJson } from "../domain/docid";
import { idInFilter } from "../domain/selection";
import { type Doc } from "../domain/doc";
import { deleteOneCmd, deleteManyCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";

import type { DestructiveGate } from "./destructiveGate.svelte";
import { snapshotForUndo, recordDelete, UNDO_DELETE_CAP } from "./documentWrites";

export { UNDO_DELETE_CAP };

/** Single-document and bulk-selection delete flows for collectionView's Data tab: both confirm via
 *  the destructive gate (policy by environment), then delete by `_id` and reload the current page. */
export function createDeleteFlow(args: {
  sessionId: string;
  db: string;
  coll: string;
  gate: DestructiveGate;
  getSelectedIds: () => { ids: string[] } | { missing: true };
  setError: (msg: string | null) => void;
  setLoading: (v: boolean) => void;
  reload: () => Promise<void>;
}) {
  function requestDelete(doc: Doc) {
    const id = idJson(doc);
    void args.gate.request(
      { op: "deleteOne", target: { db: args.db, coll: args.coll, detail: `_id = ${id ?? "(no _id)"}` }, count: 1, undoable: true },
      () => deleteOne(doc),
    );
  }

  async function deleteOne(d: Doc) {
    const id = idJson(d);
    if (id === null) {
      args.setError(m.collection_view_no_id_delete());
      return;
    }
    args.setLoading(true);
    try {
      const snapshot = await snapshotForUndo(args.sessionId, args.db, args.coll, [id]);
      await commandLog.pushTimed(deleteOneCmd(args.coll, id), args.sessionId, () =>
        deleteDocument(args.sessionId, args.db, args.coll, id));
      recordDelete(args.sessionId, args.db, args.coll, snapshot);
      await args.reload(); // owns clearing loading
    } catch (e) {
      args.setError(errorMessage(e));
      args.setLoading(false);
    }
  }

  function requestDeleteSelected(count: number) {
    if (count === 0) return;
    void args.gate.request(
      { op: "deleteMany", target: { db: args.db, coll: args.coll }, count, undoable: count <= UNDO_DELETE_CAP },
      deleteSelected,
    );
  }

  async function deleteSelected() {
    const sel = args.getSelectedIds();
    if ("missing" in sel) {
      args.setError(m.collection_view_selection_missing_id_delete());
      return;
    }
    const filter = idInFilter(sel.ids);
    args.setLoading(true);
    try {
      // Full copies first (the grid may hold projected rows) so the delete can be undone.
      const snapshot = await snapshotForUndo(args.sessionId, args.db, args.coll, sel.ids);
      await commandLog.pushTimed(deleteManyCmd(args.coll, filter), args.sessionId, () =>
        deleteMany(args.sessionId, args.db, args.coll, filter, false));
      recordDelete(args.sessionId, args.db, args.coll, snapshot);
      await args.reload(); // reload → loadPage → clearSelection (owns clearing loading)
    } catch (e) {
      args.setError(errorMessage(e));
      args.setLoading(false);
    }
  }

  return { requestDelete, requestDeleteSelected };
}
