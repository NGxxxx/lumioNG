<script lang="ts">
  import type { createCollectionView } from "../stores/collectionView.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import BulkDialog from "./BulkDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import { idJson } from "../domain/docid";
  import { isEmptyFilter } from "../domain/bulk";
  import * as m from "#lib/paraglide/messages.js";

  let { v, coll, onMenuSelect }: {
    v: ReturnType<typeof createCollectionView>;
    coll: string;
    onMenuSelect: (action: string) => void;
  } = $props();
</script>

{#if v.bulkMode}
  <BulkDialog
    mode={v.bulkMode}
    scope={v.bulkScope}
    appliedFilter={v.appliedFilter}
    isEmpty={isEmptyFilter(v.appliedFilter)}
    selectionCount={v.bulkCount ?? 0}
    bind:updateText={v.bulkUpdateText}
    updateError={v.bulkUpdateError}
    count={v.bulkCount}
    counting={v.bulkCounting}
    running={v.bulkRunning}
    result={v.bulkResult}
    error={v.bulkError}
    canRun={v.canRunBulk}
    oncount={v.countBulk}
    onrun={v.runBulk}
    onclose={v.closeBulk}
  />
{/if}

{#if v.bulkTypeConfirm}
  <DropConfirmDialog
    title={v.bulkMode === "delete" ? m.result_table_bulk_delete_title() : m.result_table_bulk_update_title()}
    message={m.result_table_bulk_confirm_message({ coll })}
    expectedName={coll}
    onconfirm={v.confirmBulkAll}
    oncancel={v.cancelBulkAll}
  />
{/if}

{#if v.editBlurPending}
  <ConfirmDialog
    title={m.result_table_unsaved_edit_title()}
    message={m.result_table_unsaved_edit_message()}
    confirmLabel={m.common_save()}
    onconfirm={v.confirmBlurEdit}
    oncancel={v.discardBlurEdit}
  />
{/if}

{#if v.confirmDoc}
  <ConfirmDialog
    title={m.result_table_delete_doc_title()}
    message={m.result_table_delete_doc_message()}
    detail={`_id = ${idJson(v.confirmDoc) ?? "(no _id)"}`}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={v.confirmDelete}
    oncancel={v.cancelDelete}
  />
{/if}

{#if v.confirmSelectionDelete !== null}
  <ConfirmDialog
    title={m.result_table_delete_selection_title()}
    message={m.result_table_delete_selection_message({ count: v.confirmSelectionDelete })}
    confirmLabel={m.common_delete()}
    danger
    onconfirm={v.confirmDeleteSelected}
    oncancel={v.cancelDeleteSelected}
  />
{/if}

{#if v.showAllPending !== null}
  <ConfirmDialog
    title={m.result_table_show_all_title()}
    message={m.result_table_show_all_message({ count: v.showAllPending })}
    confirmLabel={m.result_table_show_all_confirm()}
    onconfirm={v.confirmShowAll}
    oncancel={v.cancelShowAll}
  />
{/if}

{#if v.menu}
  <ContextMenu
    x={v.menu.x}
    y={v.menu.y}
    items={v.menuItems()}
    onselect={onMenuSelect}
    onclose={v.closeMenu}
  />
{/if}

{#if v.exportRequest}
  {@const input = v.exportInput()}
  {#if input}<ExportWizard {input} onclose={v.cancelExport} />{/if}
{/if}
