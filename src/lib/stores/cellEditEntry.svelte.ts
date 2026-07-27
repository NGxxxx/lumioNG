import { isInlineEditable, isModalEditable, editTextOf, seedModalEditText } from "../domain/celledit";

export type CellEdit = { row: number; key: string; kind: "inline" | "modal" };

/** Shared inline/modal cell-edit entry state for the collection grid and the Query tab's result
 *  grid: which cell is open, its draft text, and the deferred seeding of big modal values.
 *  Owning the state here (instead of a copy per store) is what makes clearing it on navigation —
 *  `editing.row` indexes the OLD `docs`, so a stale entry rebinds the edit box to another
 *  document — a single change rather than two. */
export function createCellEditEntry() {
  let editing = $state<CellEdit | null>(null);
  let editText = $state("");
  let editTextLoading = $state(false);
  let editError = $state<string | null>(null);

  /** Open the cell at (row, key) for editing; returns false when `value` isn't editable at all. */
  function begin(row: number, key: string, value: unknown): boolean {
    if (isInlineEditable(key, value)) {
      editing = { row, key, kind: "inline" };
      editText = editTextOf(value);
      editTextLoading = false;
    } else if (isModalEditable(key, value)) {
      editing = { row, key, kind: "modal" };
      // Seeding the modal text (stringify of a big nested value) can be slow; show the modal
      // shell immediately with a loading state, then compute it on the next tick so it can paint first.
      editText = "";
      editTextLoading = true;
      setTimeout(() => {
        if (editing?.row !== row || editing.key !== key) return; // cancelled/changed before this ran
        editText = seedModalEditText(value);
        editTextLoading = false;
      }, 0);
    } else {
      return false;
    }
    editError = null;
    return true;
  }

  /** Leave edit mode: cancel, successful commit, or any navigation that invalidates row indices. */
  function clear() {
    editing = null;
    editText = "";
    editTextLoading = false;
    editError = null;
  }

  return {
    get editing() {
      return editing;
    },
    get editText() {
      return editText;
    },
    set editText(v: string) {
      editText = v;
    },
    get editTextLoading() {
      return editTextLoading;
    },
    get editError() {
      return editError;
    },
    set editError(v: string | null) {
      editError = v;
    },
    begin,
    clear,
  };
}
