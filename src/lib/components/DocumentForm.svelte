<script lang="ts">
  import { insertDocument, replaceDocument, idJson, errorMessage } from "../ipc";
  import type { Doc } from "../columns";
  import TreeEditor from "./TreeEditor.svelte";

  let {
    mode,
    db,
    coll,
    initial,
    onsaved,
    oncancel,
  }: {
    mode: "insert" | "edit";
    db: string;
    coll: string;
    initial: Doc | null;
    onsaved: () => void;
    oncancel: () => void;
  } = $props();

  // Nguồn sự thật: object cây. Deep-clone qua JSON để an toàn mọi môi trường.
  let docValue = $state<Doc>(mode === "insert" || !initial ? {} : JSON.parse(JSON.stringify(initial)));
  let text = $state(JSON.stringify(docValue, null, 2));
  let view = $state<"tree" | "raw">("tree");
  let treeValid = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);
  const idText = mode === "edit" && initial ? idJson(initial) : null;

  function isPlainObject(v: unknown): v is Doc {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function toRaw() {
    text = JSON.stringify(docValue, null, 2);
    error = null;
    view = "raw";
  }

  function toTree() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      error = "JSON sai cú pháp: " + (e as Error).message;
      return;
    }
    if (!isPlainObject(parsed)) {
      error = "Document phải là một object JSON.";
      return;
    }
    docValue = parsed;
    error = null;
    treeValid = true;
    view = "tree";
  }

  async function save() {
    if (view === "tree" && !treeValid) return;
    error = null;
    let payload: Doc;
    if (view === "raw") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        error = "JSON sai cú pháp: " + (e as Error).message;
        return;
      }
      if (!isPlainObject(parsed)) {
        error = "Document phải là một object JSON.";
        return;
      }
      payload = parsed;
      docValue = payload;
    } else {
      payload = docValue;
    }

    const docJson = JSON.stringify(payload);
    try {
      saving = true;
      if (mode === "insert") {
        await insertDocument(db, coll, docJson);
      } else {
        if (idText === null) {
          error = "Document không có _id để cập nhật.";
          return;
        }
        await replaceDocument(db, coll, idText, docJson);
      }
      onsaved();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="form">
  <header>
    <span>{mode === "insert" ? "New document" : "Edit document"}</span>
    <div class="views">
      <button class:active={view === "tree"} onclick={toTree} disabled={view === "tree"}>Tree</button>
      <button class:active={view === "raw"} onclick={toRaw} disabled={view === "raw"}>Raw JSON</button>
    </div>
  </header>

  {#if view === "tree"}
    <TreeEditor
      value={docValue}
      onchange={(v) => (docValue = v)}
      onvalidchange={(valid) => (treeValid = valid)}
    />
  {:else}
    <textarea bind:value={text} spellcheck="false"></textarea>
  {/if}

  {#if error}<div class="error">{error}</div>{/if}
  {#if view === "tree" && !treeValid}<div class="error">Còn field chưa hợp lệ — sửa xong mới lưu được.</div>{/if}

  <footer>
    <button onclick={oncancel} disabled={saving}>Cancel</button>
    <button onclick={save} disabled={saving || (view === "tree" && !treeValid)}>
      {saving ? "Đang lưu…" : "Save"}
    </button>
  </footer>
</div>

<style>
  .form { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .views { display: flex; gap: 4px; font-weight: 400; }
  .views button { font-size: 12px; padding: 3px 10px; border: 1px solid #ccc; background: #fff; cursor: pointer; border-radius: 3px; }
  .views button.active { background: #e8f0fe; border-color: #4a90d9; }
  textarea { flex: 1; min-height: 240px; border: none; padding: 12px; font-family: ui-monospace, monospace; font-size: 13px; resize: none; outline: none; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 14px; font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
</style>
