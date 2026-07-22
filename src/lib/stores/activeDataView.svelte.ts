/** Bridge to the currently-active data view (Data tab or active Query tab's grid) so the global toolbar can drive Edit/Delete/Export. */
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
  /** Whether this view's own embedded Command log sub-tab is showing, if it has one (instead of the app-wide docked panel). */
  readonly logOpen?: boolean;
  toggleLog?: () => void;
};

export function createActiveDataView() {
  // $state.raw: opaque references with getters — proxying would break identity checks and double-wrap the getters.
  let dataHandle = $state.raw<DataViewHandle | null>(null);
  let activeQueryId = $state.raw<number | null>(null);
  const queryHandles = new Map<number, DataViewHandle>();

  return {
    get handle() {
      return activeQueryId !== null ? (queryHandles.get(activeQueryId) ?? null) : dataHandle;
    },
    /** Data context view (ResultTable) — registers/unregisters on mount/destroy. */
    register(h: DataViewHandle) {
      dataHandle = h;
    },
    unregister(h: DataViewHandle) {
      if (dataHandle === h) dataHandle = null;
    },
    /** Query tab — register once on mount, unregister once on destroy (never on activate/deactivate). */
    registerQuery(id: number, h: DataViewHandle) {
      queryHandles.set(id, h);
    },
    unregisterQuery(id: number) {
      queryHandles.delete(id);
    },
    /** Which query tab id (if any) the toolbar should defer to; null falls back to `dataHandle`. */
    setActiveQueryId(id: number | null) {
      activeQueryId = id;
    },
  };
}

/** Singleton used by the app shell (tests build their own via createActiveDataView). */
export const activeDataView = createActiveDataView();
