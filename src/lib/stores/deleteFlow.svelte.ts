import * as m from "$lib/paraglide/messages";
import { deleteDocument, deleteMany } from "../api/documents";
import { errorMessage } from "../api/errors";
import { idJson } from "../domain/docid";
import { idInFilter } from "../domain/selection";
import { type Doc } from "../domain/doc";
import { deleteOneCmd, deleteManyCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";

/** Single-document and bulk-selection delete flows for collectionView's Data tab: both confirm via
 *  a dialog, then delete by `_id` and reload the current page. */
export function createDeleteFlow(args: {
  sessionId: string;
  db: string;
  coll: string;
  getSelectedIds: () => { ids: string[] } | { missing: true };
  setError: (msg: string | null) => void;
  setLoading: (v: boolean) => void;
  reload: () => Promise<void>;
}) {
  let confirmDoc = $state<Doc | null>(null);
  let confirmSelectionDelete = $state<number | null>(null);

  function requestDelete(doc: Doc) {
    confirmDoc = doc;
  }

  function cancelDelete() {
    confirmDoc = null;
  }

  async function confirmDelete() {
    const d = confirmDoc;
    confirmDoc = null;
    if (!d) return;
    const id = idJson(d);
    if (id === null) {
      args.setError(m.collection_view_no_id_delete());
      return;
    }
    args.setLoading(true);
    try {
      await commandLog.pushTimed(deleteOneCmd(args.coll, id), args.sessionId, () =>
        deleteDocument(args.sessionId, args.db, args.coll, id));
      await args.reload(); // owns clearing loading
    } catch (e) {
      args.setError(errorMessage(e));
      args.setLoading(false);
    }
  }

  function requestDeleteSelected(count: number) {
    if (count === 0) return;
    confirmSelectionDelete = count;
  }

  function cancelDeleteSelected() {
    confirmSelectionDelete = null;
  }

  async function confirmDeleteSelected() {
    confirmSelectionDelete = null;
    const sel = args.getSelectedIds();
    if ("missing" in sel) {
      args.setError(m.collection_view_selection_missing_id_delete());
      return;
    }
    const filter = idInFilter(sel.ids);
    args.setLoading(true);
    try {
      await commandLog.pushTimed(deleteManyCmd(args.coll, filter), args.sessionId, () =>
        deleteMany(args.sessionId, args.db, args.coll, filter, false));
      await args.reload(); // reload → loadPage → clearSelection (owns clearing loading)
    } catch (e) {
      args.setError(errorMessage(e));
      args.setLoading(false);
    }
  }

  return {
    get confirmDoc() {
      return confirmDoc;
    },
    get confirmSelectionDelete() {
      return confirmSelectionDelete;
    },
    requestDelete,
    cancelDelete,
    confirmDelete,
    requestDeleteSelected,
    cancelDeleteSelected,
    confirmDeleteSelected,
  };
}
