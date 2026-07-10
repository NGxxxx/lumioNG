/**
 * Bridge to the currently-mounted collection data view so the global toolbar can drive its
 * actions (Edit selected document, Delete selected, Export). The selection/filter state lives
 * inside the per-collection `collectionView` store (created in ResultTable); ResultTable registers
 * a handle here on mount and unregisters on destroy. `canEdit`/`canExport`/`canDelete` are getters
 * so the toolbar stays reactive to selection changes.
 */
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
  // $state.raw: the handle is an opaque reference (and carries getters); proxying it would both
  // break the identity check in unregister() and double-wrap the getters. Reassignment stays reactive.
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
