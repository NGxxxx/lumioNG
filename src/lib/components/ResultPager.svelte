<script lang="ts">
  import type { GridPageView } from "../domain/gridView";
  import * as m from "$lib/paraglide/messages";

  let { v }: { v: GridPageView } = $props();
</script>

{#if v.allShown}
  <div class="pager">
    <button class="pg-btn" onclick={v.firstPage} title={m.result_table_pager_back_to_paged()}>{m.result_table_pager_back_to_paged()}</button>
    <label class="pg-rows">{m.result_table_pager_rows()}
      <input type="number" min="1" value={v.pageSize}
        onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))} />
    </label>
    <span class="pg-total">{m.result_table_pager_all_docs({ count: v.totalCount })}</span>
  </div>
{:else}
  <div class="pager">
    <button class="pg-btn" onclick={v.firstPage} disabled={v.currentPage <= 1} title={m.result_table_pager_first()}>«</button>
    <button class="pg-btn" onclick={v.prevPage} disabled={v.currentPage <= 1} title={m.result_table_pager_prev()}>‹</button>
    <span class="pg-info">
      <input class="pg-jump" type="number" min="1" max={v.pageCount} value={v.currentPage}
        onchange={(e) => v.goToPage(Math.max(1, +e.currentTarget.value || 1))} />
      / {v.pageCount}
    </span>
    <button class="pg-btn" onclick={v.nextPage} disabled={v.currentPage >= v.pageCount} title={m.result_table_pager_next()}>›</button>
    <button class="pg-btn" onclick={v.lastPage} disabled={v.currentPage >= v.pageCount} title={m.result_table_pager_last()}>»</button>
    <span class="pg-sep">|</span>
    <label class="pg-rows">{m.result_table_pager_rows()}
      <input type="number" min="1" value={v.pageSize}
        onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))} />
    </label>
    <button class="pg-btn" onclick={v.requestShowAll}>{m.result_table_pager_show_all()}</button>
    <span class="pg-total">{m.result_table_pager_docs({ count: v.totalCount })}</span>
  </div>
{/if}

<style>
  /* Copied verbatim from ResultTable.svelte's pre-refactor style block: the pager, pg-btn,
     pg-info, pg-jump, pg-total, pg-sep and pg-rows rules only. */
  .pager {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    height: 1.875rem;
    padding: 0 0.625rem;
    border-top: 1px solid var(--border);
    background: var(--zebra-alt);
    font-size: 0.75rem;
  }
  .pg-btn {
    height: 1.375rem;
    padding: 0 0.5rem;
    border: 1px solid var(--gray-c4);
    background: var(--bg);
    border-radius: 0.125rem;
    cursor: pointer;
    color: var(--gray-44);
  }
  .pg-btn:disabled { opacity: 0.45; cursor: default; }
  .pg-info { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-jump { width: 3.25rem; height: 1.25rem; text-align: center; }
  .pg-total { margin-left: auto; color: var(--muted); }
  .pg-sep { color: var(--gray-c4); }
  .pg-rows { display: flex; align-items: center; gap: 0.25rem; color: var(--gray-55); }
  .pg-rows input { width: 3.5rem; height: 1.25rem; text-align: center; }
</style>
