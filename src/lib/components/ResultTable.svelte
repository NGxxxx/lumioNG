<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { getCollectionView } from "../stores/collectionViews.svelte";
  import { activeDataView } from "../stores/activeDataView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import type { Doc } from "../domain/doc";
  import { idJson } from "../domain/docid";
  import type { GridPageView } from "../domain/gridView";
  import ResultTree from "./ResultTree.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import ResultPager from "./ResultPager.svelte";
  import CollectionToolbar from "./CollectionToolbar.svelte";
  import CollectionDialogs from "./CollectionDialogs.svelte";
  import DocPeekDrawer from "./DocPeekDrawer.svelte";
  import { docPeekFor } from "../stores/docPeek.svelte";
  import { settings } from "../stores/settings.svelte";
  import { undo } from "../stores/undo.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let {
    db,
    coll,
    version,
    onopendocument,
  }: {
    db: string;
    coll: string;
    version: number;
    onopendocument: (doc: Doc | null, mode: "edit" | "insert") => void;
  } = $props();

  const { view: v, isNew } = untrack(() =>
    getCollectionView(sessionManager.active?.id ?? "", db, coll, version),
  );

  let toolbarRef: CollectionToolbar | undefined;
  let treeRef: ResultTree | undefined = $state();

  const visibleColumns = $derived(v.columnFields.filter((c) => !v.hidden.has(c.path)));

  /** Thin GridPageView wrapper forwarding `v` unchanged except `columnFields`, filtered by `v.hidden` so column-chooser hides actually hide (live getters, not a one-shot spread, so it stays reactive). */
  const gridView: GridPageView = {
    get docs() { return v.docs; },
    get visibleIndices() { return v.visibleIndices; },
    get columnFields() { return visibleColumns; },
    get colWidths() { return v.colWidths; },
    setColWidth: v.setColWidth,
    resetColWidth: v.resetColWidth,

    get currentPage() { return v.currentPage; },
    get pageCount() { return v.pageCount; },
    get totalCount() { return v.totalCount; },
    get pageSize() { return v.pageSize; },
    get allShown() { return v.allShown; },
    get loading() { return v.loading; },
    goToPage: v.goToPage,
    nextPage: v.nextPage,
    prevPage: v.prevPage,
    firstPage: v.firstPage,
    lastPage: v.lastPage,
    setPageSize: v.setPageSize,
    requestShowAll: v.requestShowAll,

    get selected() { return v.selected; },
    clickRow: v.clickRow,
    setSelected: v.setSelected,
    get pinned() { return v.pinned; },
    headerMenuItems: v.headerMenuItems,
    onHeaderMenuSelect: v.onHeaderMenuSelect,
    selectAll: v.selectAll,
    get menu() { return v.menu; },
    openMenu: v.openMenu,
    closeMenu: v.closeMenu,
    menuItems: v.menuItems,

    get editing() { return v.editing; },
    get editText() { return v.editText; },
    set editText(t: string) { v.editText = t; },
    get editTextLoading() { return v.editTextLoading; },
    get editError() { return v.editError; },
    get saving() { return v.saving; },
    startEdit: v.startEdit,
    commitEdit: v.commitEdit,
    cancelEdit: v.cancelEdit,
    onEditBlur: v.onEditBlur,

    get sortKeys() { return v.sortKeys; },
    toggleSort: v.toggleSort,

    requestDeleteSelected: v.requestDeleteSelected,
    copySelectedAsJson: () => v.copySelectedAs("json"),
    invertSelection: v.invertSelection,
    newDocument: v.newDocument,
    duplicateSelected: v.duplicateSelected,
  };

  // ── Quick-look drawer ──
  // Owned by the cached view, so an open drawer — and any unsaved draft — survives view/tab switches.
  const peek = docPeekFor(v, {
    sessionId: () => sessionManager.active?.id ?? "",
    db: () => db,
    coll: () => coll,
    loadFull: (d) => v.openDoc(d),
    readOnly: () => sessionManager.active?.readOnly ?? false,
    onSaved: (saved) => v.replaceDoc(saved),
  });
  const singleSelected = $derived(v.selectedCount === 1 ? (v.docs[[...v.selected][0]] ?? null) : null);
  // While open, the drawer follows the single selected row (keyboard or click).
  $effect(() => {
    const d = singleSelected;
    if (!d || !peek.open) return;
    untrack(() => void peek.follow(d)); // no-op for the document already shown; asks first when dirty
  });
  // An undo wrote to this collection: reload the page.
  // (Changes from before this table mounted were already loaded.)
  let undoSeen = untrack(() => undo.changed?.seq ?? 0);
  $effect(() => {
    const change = undo.changed;
    if (!change || change.seq <= undoSeen) return;
    undoSeen = change.seq;
    untrack(() => {
      v.syncAfterUndo(change);
      peek.refreshIfShowing(change);
    });
  });
  // Rows changed (reload, page, inline edit): the drawer refreshes, keeps a dirty draft, or closes.
  $effect(() => {
    const docs = v.docs;
    untrack(() => peek.sync(docs));
  });
  function onPeek(row: number, edit: boolean) {
    const d = v.docs[row];
    if (d) void peek.show(d, edit);
  }
  /** Esc in the grid closes the drawer first (unless it has unsaved edits, which keep it open). */
  /** A click on empty grid space closes an unpinned drawer with nothing unsaved. */
  function onGridBackground() {
    if (peek.open && !settings.peekPinned && !peek.dirty) peek.close();
  }
  function onGridEscape(): boolean {
    if (!peek.open) return false;
    peek.requestClose();
    return true;
  }
  async function onBulk(action: "copy" | "export" | "delete") {
    if (action === "copy") await v.copySelectedAs("json");
    else if (action === "export") v.requestExport("selection");
    else v.requestDeleteSelected();
  }

  async function onMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r && "peek" in r) void peek.show(r.peek);
    else if (r && "open" in r) onopendocument(await v.openDoc(r.open), "edit");
    else if (r && "insert" in r) onopendocument(r.insert, "insert");
    else if (r && "expandFullDepth" in r) treeRef?.expandFullDepth(r.expandFullDepth);
  }

  // Bridge for the global toolbar (Edit document / Export); getters keep it reactive to selection.
  const dataViewHandle = {
    resetLayout: () => void v.resetLayout(),
    get canEdit() {
      if (v.selectedCount !== 1) return false;
      const d = v.docs[[...v.selected][0]];
      return d ? idJson(d) !== null : false;
    },
    get canExport() {
      return true;
    },
    get canDelete() {
      return v.selectedCount > 0;
    },
    async editSelected() {
      if (v.selectedCount !== 1) return;
      const d = v.docs[[...v.selected][0]];
      if (!d || idJson(d) === null) return;
      onopendocument(await v.openDoc(d), "edit");
    },
    exportCurrent() {
      v.requestExport(v.selectedCount > 0 ? "selection" : "filter");
    },
    deleteSelected() {
      v.requestDeleteSelected();
    },
    focusSearch() {
      toolbarRef?.focusSearch();
    },
  };

  onMount(() => {
    if (isNew) v.init();
    activeDataView.register(dataViewHandle);
  });
  onDestroy(() => activeDataView.unregister(dataViewHandle));
</script>

<div class="result">
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <CollectionToolbar {v} bind:view={v.view} bind:this={toolbarRef}
    treeAllExpanded={treeRef?.isAllExpanded() ?? false}
    ontoggleexpand={() => treeRef?.toggleExpandAll()} />

  <div class="content" class:with-pinned={peek.open && settings.peekPinned && v.view === "grid"}>
    {#if v.view === "grid"}
      <div class="grid-host">
        <ResultGrid v={gridView} {onopendocument} onpeek={onPeek} onescape={onGridEscape} peekOpen={peek.open} onpeekclose={() => peek.requestClose()} onbackground={onGridBackground} />
      </div>
      {#if peek.open}
        <DocPeekDrawer
          {peek}
          pinned={settings.peekPinned}
          width={settings.peekWidth}
          selectionCount={v.selectedCount}
          onresize={(px) => settings.setPeekWidth(px)}
          onpin={(b) => settings.setPeekPinned(b)}
          onopentab={async (d) => onopendocument(await v.openDoc(d), "edit")}
          onduplicate={(d) => { const { _id, ...rest } = d; void _id; onopendocument(rest as Doc, "insert"); }}
          ondelete={() => { if (peek.doc) v.requestDeleteDoc(peek.doc); }}
          onbulk={onBulk}
        />
      {/if}
    {:else}
      <div class="tree-wrap">
        <ResultTree bind:this={treeRef} docs={v.docs} startIndex={v.allShown ? 0 : (v.currentPage - 1) * v.pageSize}
          onRowMenu={(e, i, key) => v.openMenu(e, i, key, "tree")} />
        {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}
      </div>
    {/if}
  </div>
  <ResultPager {v} />
</div>

<CollectionDialogs {v} {coll} {onMenuSelect} />

<style>
  /* ── Layout ── */
  .result { display: flex; flex-direction: column; height: 100%; }
  .content { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .content.with-pinned { flex-direction: row; }
  .grid-host { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }

  /* ── Error / status messages ── */
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  /* Tree-view loading hint: overlay so it doesn't disturb the 100%-height virtual scroller. */
  .status { position: absolute; top: 0.375rem; right: 0.75rem; padding: 0.1875rem 0.5rem; color: var(--gray-77); font-size: var(--fs);
    background: color-mix(in srgb, var(--panel) 80%, transparent); border-radius: var(--radius); z-index: 5; }

  /* ── Tree view ── (rendering lives in ResultTree.svelte); shrinks to content instead of always filling. */
  .tree-wrap { flex: 0 1 auto; min-height: 0; max-height: 100%; position: relative; }
</style>
