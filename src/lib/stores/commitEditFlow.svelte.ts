import { setByPath, commitModalValue, rebuildValue, buildSetUpdate } from "../domain/celledit";
import { getByPath } from "../domain/schema";
import { idJson } from "../domain/docid";
import { updateOne } from "../api/documents";
import { updateOneCmd } from "../domain/mongosh";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { undo } from "./undo.svelte";
import type { Doc } from "../domain/doc";
import type { CellEdit } from "./cellEditEntry.svelte";

/** Shared inline/modal cell-edit commit flow for the collection grid and the Query tab's result
 *  grid: validates the draft, `$set`s only the touched path (never a full replaceDocument), patches
 *  the current page in place, and drops the result if a navigation/reload superseded it while the
 *  write was in flight. */
export function createCommitEditFlow(args: {
  /** Getter (not a plain value) so a store that later rebinds to a different session — see
   *  queryScript.svelte.ts's `rebindSession` — is picked up on the next commit without recreating this flow. */
  getSessionId: () => string;
  edit: {
    editing: CellEdit | null;
    editText: string;
    editError: string | null;
    clear(): void;
  };
  getDocs: () => Doc[];
  setDocs: (docs: Doc[]) => void;
  /** Resolves the write target for the currently-open edit; `null` means editing isn't possible right now (e.g. no live provenance), so commit is a no-op. */
  getTarget: () => { db: string; coll: string } | null;
  noIdMessage: () => string;
  currentGeneration: () => number;
  /** Called after the docs-page patch lands, still gated on the same generation check -- lets a caller keep a second, denormalized copy of the data (e.g. queryScript's `fullDocs`) in sync. */
  onCommitted?: (row: number, key: string, value: unknown) => void;
}) {
  let saving = $state(false);

  async function commitEdit() {
    const active = args.edit.editing;
    if (!active || saving) return;
    const target = args.getTarget();
    if (!target) return;
    const { row, key, kind } = active;
    const docs = args.getDocs();
    const doc = docs[row];
    if (!doc) {
      args.edit.clear();
      return;
    }
    const original = getByPath(doc, key);
    const r = kind === "modal" ? commitModalValue(original, args.edit.editText) : rebuildValue(original, args.edit.editText);
    if (!r.ok) {
      args.edit.editError = r.error;
      return;
    }
    const id = idJson(doc);
    if (id === null) {
      args.edit.editError = args.noIdMessage();
      return;
    }
    // $set only the touched path — a full replaceDocument would re-send every other field too, including any huge untouched sibling.
    const filter = `{"_id": ${id}}`;
    const update = buildSetUpdate(key, r.value);
    const gen = args.currentGeneration();
    saving = true;
    const sessionId = args.getSessionId();
    try {
      await commandLog.pushTimed(updateOneCmd(target.coll, filter, update), sessionId, () =>
        updateOne(sessionId, target.db, target.coll, filter, update, false));
      undo.record({ kind: "cell", sessionId, db: target.db, coll: target.coll, idJson: id, path: key, before: original, after: r.value });
      // The write itself targeted `_id`, so it always landed on the right document; only the local
      // patch is index-based, so skip it when a reload during the round-trip repopulated `docs`.
      // A stale generation means a newer edit may already own `edit`'s state — leave it alone.
      if (gen === args.currentGeneration()) {
        docs[row] = setByPath(docs[row], key, r.value);
        args.setDocs([...docs]);
        args.onCommitted?.(row, key, r.value);
        args.edit.clear();
      }
    } catch (e) {
      if (gen === args.currentGeneration()) args.edit.editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  return {
    get saving() { return saving; },
    commitEdit,
  };
}
