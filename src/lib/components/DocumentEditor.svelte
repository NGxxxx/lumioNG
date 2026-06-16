<script lang="ts">
  import { insertDocument, replaceDocument, idJson, errorMessage } from "../ipc";
  import type { Doc } from "../columns";

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

  // Remounted fresh per open (ResultTable {#if editorOpen}); init-once from props is intentional.
  let text = $state(mode === "insert" ? "{}" : JSON.stringify(initial, null, 2));
  let error = $state<string | null>(null);
  let saving = $state(false);
  const idText = mode === "edit" && initial ? idJson(initial) : null;

  async function save() {
    error = null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      error = "JSON sai cú pháp: " + (e as Error).message;
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      error = "Document phải là một object JSON.";
      return;
    }
    saving = true;
    try {
      if (mode === "insert") {
        await insertDocument(db, coll, text);
      } else {
        if (idText === null) {
          error = "Document không có _id để cập nhật.";
          return;
        }
        await replaceDocument(db, coll, idText, text);
      }
      onsaved();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={oncancel}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <header>{mode === "insert" ? "New document" : "Edit document"}</header>
    <textarea bind:value={text} spellcheck="false"></textarea>
    {#if error}<div class="error">{error}</div>{/if}
    <footer>
      <button onclick={oncancel} disabled={saving}>Cancel</button>
      <button onclick={save} disabled={saving}>{saving ? "Đang lưu…" : "Save"}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 640px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  textarea { flex: 1; min-height: 320px; border: none; padding: 12px; font-family: ui-monospace, monospace; font-size: 13px; resize: none; outline: none; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 14px; font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
</style>
