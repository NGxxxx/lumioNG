<!-- src/lib/components/GridFsFilesPanel.svelte -->
<script lang="ts">
  import { untrack } from "svelte";
  import { getGridfsFiles } from "../stores/gridfsFilesCache.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createRowVirtualizer } from "./rowVirtualizer.svelte";
  import { formatBytes } from "../domain/stats";
  import GridFsPreviewPanel from "./GridFsPreviewPanel.svelte";
  import type { GridfsFileRow } from "../domain/gridfsFiles";
  import * as m from "#lib/paraglide/messages.js";

  let { db, bucket, version }: { db: string; bucket: string; version: number } = $props();

  const store = untrack(() => getGridfsFiles(sessionManager.active?.id ?? "", db, bucket, version));

  let scrollerEl = $state<HTMLDivElement | null>(null);
  let previewRow = $state<GridfsFileRow | null>(null);

  const ROW_H = 28;
  const rowVirtualizer = createRowVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: () => store.rows.length,
    getScrollElement: () => scrollerEl,
    estimateSize: () => ROW_H,
    overscan: 8,
  });
  const virtualItems = $derived($rowVirtualizer.getVirtualItems());
  const totalSize = $derived($rowVirtualizer.getTotalSize());
  const padTop = $derived(virtualItems.length ? virtualItems[0].start : 0);
  const padBottom = $derived(virtualItems.length ? totalSize - virtualItems[virtualItems.length - 1].end : 0);

  function fmtDate(iso: string | null): string {
    return iso === null ? "" : new Date(iso).toLocaleString();
  }
</script>

<div class="gridfs-panel">
  <div class="gridfs-header">
    <span class="gridfs-bucket">{bucket}</span>
    <span class="gridfs-count">{m.gridfs_file_count({ count: store.totalCount })}</span>
    <input
      class="gridfs-search"
      type="text"
      placeholder={m.gridfs_search_placeholder()}
      value={store.search}
      oninput={(e) => store.setSearch(e.currentTarget.value)}
    />
  </div>
  <div class="gridfs-scroller" bind:this={scrollerEl}>
    {#if store.error}
      <div class="gridfs-status gridfs-error">{store.error}</div>
    {:else}
      <table class="gridfs-table">
        <thead>
          <tr>
            <th>{m.gridfs_col_filename()}</th>
            <th>{m.gridfs_col_length()}</th>
            <th>{m.gridfs_col_content_type()}</th>
            <th>{m.gridfs_col_upload_date()}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#if padTop > 0}
            <tr aria-hidden="true"><td colspan="5" style="height:{padTop}px; padding:0; border:0;"></td></tr>
          {/if}
          {#each virtualItems as vi (vi.index)}
            {@const row = store.rows[vi.index]}
            <tr data-index={vi.index}>
              <td>{row.filename ?? ""}</td>
              <td>{formatBytes(row.length)}</td>
              <td>{row.contentType ?? ""}</td>
              <td>{fmtDate(row.uploadDateIso)}</td>
              <td><button onclick={() => (previewRow = row)}>{m.gridfs_preview_button()}</button></td>
            </tr>
          {/each}
          {#if padBottom > 0}
            <tr aria-hidden="true"><td colspan="5" style="height:{padBottom}px; padding:0; border:0;"></td></tr>
          {/if}
        </tbody>
      </table>
    {/if}
  </div>
  <div class="gridfs-pager">
    <button onclick={store.prevPage} disabled={store.currentPage <= 1}>‹</button>
    <span>{store.currentPage} / {store.pageCount}</span>
    <button onclick={store.nextPage} disabled={store.currentPage >= store.pageCount}>›</button>
  </div>
</div>

{#if previewRow !== null}
  <GridFsPreviewPanel {db} {bucket} row={previewRow} onclose={() => (previewRow = null)} />
{/if}

<style>
  .gridfs-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .gridfs-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 0.625rem; border-bottom: 1px solid var(--border); font-size: var(--fs); }
  .gridfs-bucket { font-weight: 600; }
  .gridfs-count { color: var(--muted); }
  .gridfs-search { margin-left: auto; height: 1.5rem; padding: 0 0.375rem; }
  .gridfs-scroller { flex: 1; min-height: 0; overflow: auto; }
  .gridfs-table { width: 100%; border-collapse: collapse; font-size: var(--fs); }
  .gridfs-table th { text-align: left; position: sticky; top: 0; background: var(--panel); border-bottom: 1px solid var(--border); padding: 0.25rem 0.5rem; }
  .gridfs-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .gridfs-status { padding: 0.75rem; color: var(--muted); }
  .gridfs-error { color: var(--danger, #c0392b); }
  .gridfs-pager { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.625rem; border-top: 1px solid var(--border); font-size: var(--fs); }
</style>
