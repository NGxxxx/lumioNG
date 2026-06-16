<script lang="ts">
  import { onMount } from "svelte";
  import { queryPage, lastObjectId, errorMessage } from "../ipc";
  import { deriveColumnKeys, type Doc } from "../columns";
  import BsonCell from "./BsonCell.svelte";

  let { db, coll }: { db: string; coll: string } = $props();

  let docs = $state<Doc[]>([]);
  let keys = $state<string[]>([]);
  let loading = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement>();

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    error = null;
    try {
      const after = lastObjectId(docs);
      if (docs.length > 0 && after === null) {
        done = true;
        error = "Phân trang chỉ hỗ trợ _id kiểu ObjectId trong slice này.";
        return;
      }
      const batch = await queryPage(db, coll, after, 50);
      if (batch.length === 0) {
        done = true;
      } else {
        docs = [...docs, ...batch];
        keys = deriveColumnKeys(docs);
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function onScroll() {
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    if (scrollHeight - scrollTop - clientHeight < 300) loadMore();
  }

  onMount(() => {
    loadMore();
  });
</script>

<div class="result">
  {#if error}<div class="error">{error}</div>{/if}
  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <table>
      <thead><tr>{#each keys as k}<th>{k}</th>{/each}</tr></thead>
      <tbody>
        {#each docs as d}
          <tr>{#each keys as k}<td>{#if k in d}<BsonCell value={d[k]} />{/if}</td>{/each}</tr>
        {/each}
      </tbody>
    </table>
    {#if loading}<div class="status">Đang tải…</div>{/if}
    {#if done}<div class="status">— hết —</div>{/if}
  </div>
</div>

<style>
  .result { display: flex; flex-direction: column; height: 100%; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e0e0e0; padding: 4px 8px; text-align: left; }
  th { position: sticky; top: 0; background: #f5f5f5; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px; color: #777; font-size: 12px; }
</style>
