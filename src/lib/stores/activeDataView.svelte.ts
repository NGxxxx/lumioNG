/** Bridge to the currently-mounted collection data view so the global toolbar can drive its actions (Edit/Delete/Export); ResultTable registers/unregisters the handle on mount/destroy. */
export type DataViewHandle = {
  readonly canEdit: boolean;
  readonly canExport: boolean;
  readonly canDelete: boolean;
  editSelected: () => void;
  exportCurrent: () => void;
  deleteSelected: () => void;
  /** Focuses this view's quick-search input (global toolbar's Find button). Optional since not
   *  every future registrant is guaranteed to have a search box. */
  focusSearch?: () => void;
};

export function createActiveDataView() {
  // $state.raw: the handle is an opaque reference with getters — proxying would break unregister()'s identity check and double-wrap the getters.
  let handle = $state.raw<DataViewHandle | null>(null);
  return {
    get handle() {
      return handle;
    },
    register(h: DataViewHandle) {
      handle = h;
    },
    /** Clear only if `h` is still active — a remount's old cleanup must not wipe the new handle. */
    unregister(h: DataViewHandle) {
      if (handle === h) handle = null;
    },
  };
}

/** Singleton used by the app shell (tests build their own via createActiveDataView). */
export const activeDataView = createActiveDataView();
