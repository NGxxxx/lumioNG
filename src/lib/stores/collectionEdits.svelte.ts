import * as m from "#lib/paraglide/messages.js";
import { pendingKeys } from "../domain/pendingEdits";
import { getByPath } from "../domain/schema";
import type { Doc } from "../domain/doc";
import { pendingEdits } from "./pendingEdits.svelte";
import { settings } from "./settings.svelte";
import { createGridEditBlur } from "./cellEditBlur.svelte";
import { createCellEditEntry } from "./cellEditEntry.svelte";
import { createCommitEditFlow } from "./commitEditFlow.svelte";

/** What the edits block needs from the owning collection view (all read lazily). */
export interface CollectionEditsCtx {
  sessionId: string;
  db: string;
  coll: string;
  getDocs: () => Doc[];
  setDocs: (next: Doc[]) => void;
  currentGeneration: () => number;
  /** True while a projection hides some fields (the row must be re-fetched in full before editing). */
  hasHidden: () => boolean;
  /** Full document for a row (re-fetched when a projection hides fields). */
  fullDocFor: (d: Doc) => Promise<Doc>;
  setError: (msg: string | null) => void;
  reloadDocs: () => Promise<void>;
}

/** Inline/modal cell edit plus the staged (pending) edits of one collection view. */
export function createCollectionEdits(ctx: CollectionEditsCtx) {
  const { sessionId, db, coll } = ctx;

  // Inline/modal cell edit (same factory as the Query tab's result grid).
  const edit = createCellEditEntry();

  async function startEdit(row: number, key: string) {
    if (ctx.hasHidden()) {
      // Same guard as every other awaiting flow here: a page/filter/sort change during the re-fetch
      // makes `row` point at a different document, so drop this result instead of writing it back.
      const gen = ctx.currentGeneration();
      const fullRow = await ctx.fullDocFor(ctx.getDocs()[row]);
      if (gen !== ctx.currentGeneration()) return;
      if (fullRow !== ctx.getDocs()[row]) {
        ctx.getDocs()[row] = fullRow;
        ctx.setDocs([...ctx.getDocs()]);
      }
    }
    edit.begin(row, key, getByPath(ctx.getDocs()[row], key));
  }

  const editBlur = createGridEditBlur(edit, ctx.getDocs, () => commitFlow);

  const commitFlow = createCommitEditFlow({
    getSessionId: () => sessionId,
    edit,
    getDocs: ctx.getDocs,
    setDocs: ctx.setDocs,
    getTarget: () => ({ db, coll }),
    noIdMessage: () => m.collection_view_no_id_update(),
    currentGeneration: ctx.currentGeneration,
    stage: {
      enabled: () => settings.stageCellEdits,
      put: (e) => pendingEdits.stage(sessionId, db, coll, e),
    },
  });

  // ── Staged edits (settings.stageCellEdits): kept by namespace, overlaid on every page load ──
  const pending = () => pendingEdits.list(sessionId, db, coll);
  const pendingCells = $derived(pendingKeys(pending()));

  async function commitPending() {
    const r = await pendingEdits.commit(sessionId, db, coll);
    if (r.error) ctx.setError(r.error);
  }

  /** Drops the staged edits and reloads the page so the grid shows the stored values again. */
  async function discardPending() {
    pendingEdits.discard(sessionId, db, coll);
    await ctx.reloadDocs();
  }

  return {
    edit,
    editBlur,
    commitFlow,
    pending,
    get pendingCells() { return pendingCells; },
    startEdit,
    commitPending,
    discardPending,
  };
}
