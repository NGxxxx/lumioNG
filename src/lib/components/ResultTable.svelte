<script lang="ts">
  import { onMount } from "svelte";
  import { queryPage, lastObjectId, errorMessage, deleteDocument, idJson } from "../ipc";
  import { deriveColumnKeys, type Doc } from "../columns";
  import BsonCell from "./BsonCell.svelte";
  import DocumentEditor from "./DocumentEditor.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let { db, coll }: { db: string; coll: string } = $props();

  let docs = $state<Doc[]>([]);
  let keys = $state<string[]>([]);
  let loading = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement>();

  // Editor + confirm state (slice #2a)
  let editorOpen = $state(false);
  let editorMode = $state<"insert" | "edit">("insert");
  let editorDoc = $state<Doc | null>(null);
  let confirmDoc = $state<Doc | null>(null);

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

  function reset() {
    docs = [];
    keys = [];
    done = false;
    error = null;
    loadMore();
  }

  function onScroll() {
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    if (scrollHeight - scrollTop - clientHeight < 300) loadMore();
  }

  function openInsert() {
    editorMode = "insert";
    editorDoc = null;
    editorOpen = true;
  }

  function openEdit(d: Doc) {
    editorMode = "edit";
    editorDoc = d;
    editorOpen = true;
  }

  function onSaved() {
    editorOpen = false;
    reset();
  }

  async function confirmDelete() {
    const d = confirmDoc;
    confirmDoc = null;
    if (!d) return;
    const id = idJson(d);
    if (id === null) {
      error = "Document không có _id để xóa.";
      return;
    }
    try {
      await deleteDocument(db, coll, id);
      reset();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  onMount(() => {
    loadMore();
  });
</script>

<div class="result">
  <div class="toolbar">
    <button onclick={openInsert}>+ New document</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <table>
      <thead>
        <tr><th class="actions"></th>{#each keys as k}<th>{k}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each docs as d}
          <tr>
            <td class="actions">
              <button onclick={() => openEdit(d)}>Edit</button>
              <button onclick={() => (confirmDoc = d)}>Delete</button>
            </td>
            {#each keys as k}<td>{#if k in d}<BsonCell value={d[k]} />{/if}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if loading}<div class="status">Đang tải…</div>{/if}
    {#if done}<div class="status">— hết —</div>{/if}
  </div>
</div>

{#if editorOpen}
  <DocumentEditor
    mode={editorMode}
    {db}
    {coll}
    initial={editorDoc}
    onsaved={onSaved}
    oncancel={() => (editorOpen = false)}
  />
{/if}

{#if confirmDoc}
  <ConfirmDialog
    idText={idJson(confirmDoc) ?? "(không có _id)"}
    onconfirm={confirmDelete}
    oncancel={() => (confirmDoc = null)}
  />
{/if}

<style>
  .result { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e0e0e0; padding: 4px 8px; text-align: left; }
  th { position: sticky; top: 0; background: #f5f5f5; }
  td.actions, th.actions { white-space: nowrap; }
  td.actions button { font-size: 11px; margin-right: 4px; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px; color: #777; font-size: 12px; }
</style>
