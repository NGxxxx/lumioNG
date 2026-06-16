<script lang="ts">
  import { onMount } from "svelte";
  import { queryPage, lastObjectId, errorMessage, deleteDocument, replaceDocument, idJson } from "../ipc";
  import { deriveColumnKeys, type Doc } from "../columns";
  import { isInlineEditable, editTextOf, rebuildValue } from "../celledit";
  import BsonCell from "./BsonCell.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";

  let {
    db,
    coll,
    onopendocument,
  }: {
    db: string;
    coll: string;
    onopendocument: (doc: Doc | null, mode: "edit" | "insert") => void;
  } = $props();

  let docs = $state<Doc[]>([]);
  let keys = $state<string[]>([]);
  let loading = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement>();

  let confirmDoc = $state<Doc | null>(null);

  // Inline cell edit
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Context menu
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

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

  function startEdit(row: number, key: string) {
    if (!isInlineEditable(key, docs[row][key])) return;
    editing = { row, key };
    editText = editTextOf(docs[row][key]);
    editError = null;
  }

  function cancelEdit() {
    if (saving) return;
    editing = null;
    editError = null;
  }

  async function commitEdit() {
    if (!editing || saving) return;
    const { row, key } = editing;
    const r = rebuildValue(docs[row][key], editText);
    if (!r.ok) {
      editError = r.error;
      return;
    }
    const newDoc: Doc = { ...docs[row], [key]: r.value };
    const id = idJson(newDoc);
    if (id === null) {
      editError = "Document không có _id để cập nhật.";
      return;
    }
    saving = true;
    try {
      await replaceDocument(db, coll, id, JSON.stringify(newDoc));
      docs[row] = newDoc;
      docs = [...docs];
      editing = null;
      editError = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  function openMenu(e: MouseEvent, row: number, key: string) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, row, key };
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const value = docs[menu.row][menu.key];
    return [
      { label: "Open document", action: "open" },
      { label: "Delete document", action: "delete" },
      { label: "Copy value", action: "copyValue" },
      { label: "Copy _id", action: "copyId", disabled: idJson(docs[menu.row]) === null },
      { label: "Edit cell", action: "editCell", disabled: !isInlineEditable(menu.key, value) },
    ];
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      error = "Không copy được vào clipboard.";
    }
  }

  function onMenuSelect(action: string) {
    if (!menu) return;
    const row = menu.row;
    const key = menu.key;
    const doc = docs[row];
    menu = null;
    switch (action) {
      case "open":
        onopendocument(doc, "edit");
        break;
      case "delete":
        confirmDoc = doc;
        break;
      case "copyValue":
        copy(JSON.stringify(doc[key]));
        break;
      case "copyId":
        copy(idJson(doc) ?? "");
        break;
      case "editCell":
        startEdit(row, key);
        break;
    }
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
      docs = docs.filter((x) => x !== d);
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
    <button onclick={() => onopendocument(null, "insert")}>+ New document</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <table>
      <thead>
        <tr><th class="actions"></th>{#each keys as k}<th>{k}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each docs as d, row}
          <tr>
            <td class="actions">
              <button onclick={() => onopendocument(d, "edit")}>Edit</button>
              <button onclick={() => (confirmDoc = d)}>Delete</button>
            </td>
            {#each keys as k}
              <td oncontextmenu={(e) => openMenu(e, row, k)} ondblclick={() => startEdit(row, k)}>
                {#if editing && editing.row === row && editing.key === k}
                  <input
                    class="celledit"
                    bind:value={editText}
                    onkeydown={onEditKey}
                    onblur={cancelEdit}
                    use:focusSelect
                  />
                  {#if editError}<div class="cellerror">{editError}</div>{/if}
                {:else if k in d}
                  <BsonCell value={d[k]} />
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if loading}<div class="status">Đang tải…</div>{/if}
    {#if done}<div class="status">— hết —</div>{/if}
  </div>
</div>

{#if confirmDoc}
  <ConfirmDialog
    idText={idJson(confirmDoc) ?? "(không có _id)"}
    onconfirm={confirmDelete}
    oncancel={() => (confirmDoc = null)}
  />
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onselect={onMenuSelect} onclose={() => (menu = null)} />
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
  .celledit { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 13px; padding: 2px 4px; }
  .cellerror { color: #b71c1c; font-size: 11px; margin-top: 2px; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .status { padding: 8px; color: #777; font-size: 12px; }
</style>
