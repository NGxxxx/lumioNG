import { getByPath } from "../domain/schema";
import { editTextOf } from "../domain/celledit";
import type { Doc } from "../domain/doc";
import type { createCellEditEntry } from "./cellEditEntry.svelte";

/** Shared discard-on-blur flow for inline/modal cell editing (collectionView + queryScript share
 *  this exact behavior): blur cancels silently when nothing changed, otherwise asks for
 *  confirmation before saving (Enter still saves immediately, no confirmation). */
export function createEditBlurFlow(opts: {
  getEditing: () => { row: number; key: string } | null;
  isSaving: () => boolean;
  clearEditing: () => void;
  getEditText: () => string;
  getOriginalText: (row: number, key: string) => string;
  commitEdit: () => Promise<void>;
}) {
  let editBlurPending = $state(false);

  function cancelEdit() {
    if (opts.isSaving()) return;
    opts.clearEditing();
  }

  function onEditBlur() {
    const editing = opts.getEditing();
    if (!editing || opts.isSaving()) return;
    const original = opts.getOriginalText(editing.row, editing.key);
    if (opts.getEditText() === original) cancelEdit();
    else editBlurPending = true;
  }

  async function confirmBlurEdit() {
    editBlurPending = false;
    await opts.commitEdit();
  }

  function discardBlurEdit() {
    editBlurPending = false;
    cancelEdit();
  }

  return {
    get editBlurPending() {
      return editBlurPending;
    },
    cancelEdit,
    onEditBlur,
    confirmBlurEdit,
    discardBlurEdit,
  };
}

/** `createEditBlurFlow` wired to a grid: a cell-edit entry, the shown docs and the commit flow
 *  (passed as a getter because the commit flow is usually created after this). */
export function createGridEditBlur(
  edit: ReturnType<typeof createCellEditEntry>,
  getDocs: () => Doc[],
  commit: () => { saving: boolean; commitEdit(): Promise<void> },
) {
  return createEditBlurFlow({
    getEditing: () => edit.editing,
    isSaving: () => commit().saving,
    clearEditing: () => edit.clear(),
    getEditText: () => edit.editText,
    getOriginalText: (row, key) => {
      const d = getDocs()[row];
      return d ? editTextOf(getByPath(d, key)) : "";
    },
    commitEdit: () => commit().commitEdit(),
  });
}
