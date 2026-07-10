/**
 * Bridge to the currently active Document Form work tab (insert/edit) so the global toolbar's
 * Save button can drive it. Mirrors activeDataView: DocumentForm registers a handle while it's
 * the active work tab and unregisters when it stops being active or unmounts.
 */
export type DocumentFormHandle = {
  readonly canSave: boolean;
  save: () => void;
};

export function createActiveDocumentForm() {
  // $state.raw: the handle is an opaque reference (and carries getters); proxying it would both
  // break the identity check in unregister() and double-wrap the getters. Reassignment stays reactive.
  let handle = $state.raw<DocumentFormHandle | null>(null);
  return {
    get handle() {
      return handle;
    },
    register(h: DocumentFormHandle) {
      handle = h;
    },
    /** Clear only if `h` is still active — a remount's old cleanup must not wipe the new handle. */
    unregister(h: DocumentFormHandle) {
      if (handle === h) handle = null;
    },
  };
}

/** Singleton used by the app shell (tests build their own via createActiveDocumentForm). */
export const activeDocumentForm = createActiveDocumentForm();
