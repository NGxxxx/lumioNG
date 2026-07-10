/** Bridge to the currently active Document Form tab so the global toolbar's Save button can drive it; DocumentForm registers/unregisters the handle as it becomes/stops being active (mirrors activeDataView). */
export type DocumentFormHandle = {
  readonly canSave: boolean;
  save: () => void;
};

export function createActiveDocumentForm() {
  // $state.raw: the handle is an opaque reference with getters — proxying would break unregister()'s identity check and double-wrap the getters.
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
