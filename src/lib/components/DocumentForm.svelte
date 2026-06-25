<script lang="ts">
  import { untrack } from "svelte";
  import { insertDocument, replaceDocument } from "../api/documents";
  import { errorMessage } from "../api/errors";
  import { idJson } from "../domain/docid";
  import type { Doc } from "../domain/doc";
  import { parseDocumentText } from "../domain/docparse";
  import { commandLog } from "../stores/commandLog.svelte";
  import { insertCmd, replaceCmd } from "../domain/mongosh";
  import TreeEditor from "./TreeEditor.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

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

  // Source of truth: tree object. Deep-clone via JSON for safety across all environments.
  // Props are immutable for the component lifetime (tab remounts by id) — read only initial values.
  // `initial` serves both edit (original doc) and pre-filled insert (New skeleton / Duplicate copy);
  // insert without initial → empty form.
  let docValue = $state<Doc>(
    untrack(() => (initial ? JSON.parse(JSON.stringify(initial)) : {})),
  );
  let text = $state(untrack(() => JSON.stringify(docValue, null, 2)));
  let view = $state<"tree" | "raw">("tree");
  let treeValid = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);
  const idText = $derived(mode === "edit" && initial ? idJson(initial) : null);

  // Field count derived from top-level keys of docValue
  const fieldCount = $derived(Object.keys(docValue).length);

  // JSON validation status derived from current text (only relevant in raw view)
  const jsonValid = $derived(view === "raw" ? parseDocumentText(text).ok : true);

  // Line numbers for the JSON gutter
  const lineNumbers = $derived(
    text
      .split("\n")
      .map((_, i) => i + 1)
      .join("\n"),
  );

  function toRaw() {
    text = JSON.stringify(docValue, null, 2);
    error = null;
    view = "raw";
  }

  function toTree() {
    const r = parseDocumentText(text);
    if (!r.ok) {
      error = r.detail ? `${msgKey(r.error)}: ${r.detail}` : msgKey(r.error);
      return;
    }
    docValue = r.doc;
    error = null;
    treeValid = true;
    view = "tree";
  }

  async function save() {
    if (view === "tree" && !treeValid) return;
    error = null;
    let payload: Doc;
    if (view === "raw") {
      const r = parseDocumentText(text);
      if (!r.ok) {
        error = r.detail ? `${msgKey(r.error)}: ${r.detail}` : msgKey(r.error);
        return;
      }
      payload = r.doc;
      docValue = payload;
    } else {
      payload = docValue;
    }

    const docJson = JSON.stringify(payload);
    try {
      saving = true;
      if (mode === "insert") {
        await insertDocument(db, coll, docJson);
        commandLog.push(insertCmd(coll, docJson));
      } else {
        if (idText === null) {
          error = m.document_form_no_id_error();
          return;
        }
        await replaceDocument(db, coll, idText, docJson);
        commandLog.push(replaceCmd(coll, idText, docJson));
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
    <!-- Pencil icon -->
    <svg width="15" height="15" viewBox="0 0 16 16" class="header-icon" aria-hidden="true">
      <path d="M2 11l7-7 3 3-7 7H2z" fill="#f0d574" stroke="#b89534" stroke-width="0.9"/>
      <path d="M10 3l2-2 3 3-2 2z" fill="#9fb4cc" stroke="#5b7088" stroke-width="0.8"/>
    </svg>
    <span class="header-title">
      {mode === "insert" ? m.document_form_title_insert() : m.document_form_title_edit()} — {db}.{coll}
    </span>
  </header>

  <div class="subtabs">
    <button
      class="subtab"
      class:subtab-active={view === "raw"}
      onclick={toRaw}
    >{m.document_form_tab_json()}</button>
    <button
      class="subtab"
      class:subtab-active={view === "tree"}
      onclick={toTree}
    >{m.document_form_tab_tree()}</button>
  </div>

  <div class="editor-body">
    {#if view === "tree"}
      <TreeEditor
        value={docValue}
        onchange={(v) => (docValue = v)}
        onvalidchange={(valid) => (treeValid = valid)}
      />
    {:else}
      <div class="json-area">
        <div class="gutter" aria-hidden="true">{lineNumbers}</div>
        <textarea bind:value={text} spellcheck="false" class="json-textarea"></textarea>
      </div>
    {/if}
  </div>

  {#if error}<div class="error">{error}</div>{/if}
  {#if view === "tree" && !treeValid}<div class="error">{m.document_form_invalid_fields_error()}</div>{/if}

  <footer>
    <span class="footer-status">
      {#if view === "tree"}
        {treeValid ? m.document_form_status_valid() : m.document_form_status_invalid()} · {m.document_form_status_fields({ count: fieldCount })}
      {:else}
        {jsonValid ? `${m.document_form_status_valid_json()} · ${m.document_form_status_fields({ count: fieldCount })}` : m.document_form_status_invalid_json()}
      {/if}
    </span>
    <div class="footer-actions">
      <button class="btn-save" onclick={save} disabled={saving || (view === "tree" && !treeValid)}>
        {saving ? m.document_form_saving() : m.common_save()}
      </button>
      <button class="btn-cancel" onclick={oncancel} disabled={saving}>{m.common_cancel()}</button>
    </div>
  </footer>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #f0f0f0;
    font-family: inherit;
  }

  /* Header */
  header {
    display: flex;
    align-items: center;
    height: 2.125rem;
    flex: none;
    background: #fff;
    border-bottom: 1px solid #dcdcdc;
    padding: 0 0.75rem;
    gap: 0.4375rem;
  }
  .header-icon { flex: none; }
  .header-title { font-weight: 600; font-size: 0.8125rem; }

  /* Sub-tabs */
  .subtabs {
    display: flex;
    align-items: center;
    height: 1.75rem;
    flex: none;
    background: #f6f6f6;
    border-bottom: 1px solid #e2e2e2;
    padding: 0 0.625rem;
    gap: 0.125rem;
  }
  .subtab {
    padding: 0.1875rem 0.6875rem;
    color: #666;
    cursor: pointer;
    background: transparent;
    border: none;
    font-size: 0.75rem;
    font-weight: 400;
    border-radius: 0.1875rem 0.1875rem 0 0;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .subtab-active {
    background: #fff;
    border: 1px solid #cfcfcf;
    border-bottom: 1px solid #fff;
    margin-bottom: -1px;
    font-weight: 600;
    color: #222;
  }

  /* Editor body */
  .editor-body {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
    background: #fffef9;
  }

  /* JSON area with gutter */
  .json-area {
    flex: 1;
    display: flex;
    overflow: auto;
    min-height: 0;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
  }
  .gutter {
    width: 2.5rem;
    flex: none;
    text-align: right;
    color: #bbb;
    padding: 0.625rem 0.5rem 0 0;
    user-select: none;
    border-right: 1px solid #eee;
    background: #faf9f3;
    white-space: pre;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
    overflow: hidden;
  }
  .json-textarea {
    flex: 1;
    border: none;
    padding: 0.625rem 0.875rem;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
    resize: none;
    outline: none;
    background: #fffef9;
    color: #222;
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
    min-height: 100%;
  }

  /* Error */
  .error {
    background: #fdecea;
    color: #b71c1c;
    padding: 0.375rem 0.875rem;
    font-size: 0.75rem;
    flex: none;
  }

  /* Footer */
  footer {
    display: flex;
    align-items: center;
    height: 2.875rem;
    flex: none;
    border-top: 1px solid #cfcfcf;
    padding: 0 0.75rem;
    gap: 0.5rem;
    background: #fff;
  }
  .footer-status {
    color: #888;
    font-size: 0.6875rem;
  }
  .footer-actions {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
  }
  .btn-save {
    display: flex;
    align-items: center;
    height: 1.75rem;
    padding: 0 1.25rem;
    background: #1f9d4d;
    color: #fff;
    border: none;
    border-radius: 0.1875rem;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8125rem;
  }
  .btn-save:hover:not(:disabled) { background: #1a8a43; }
  .btn-save:disabled { opacity: 0.6; cursor: default; }
  .btn-cancel {
    display: flex;
    align-items: center;
    height: 1.75rem;
    padding: 0 1.25rem;
    background: #fff;
    border: 1px solid #b8b8b8;
    border-radius: 0.1875rem;
    cursor: pointer;
    font-size: 0.8125rem;
  }
  .btn-cancel:hover:not(:disabled) { background: #eee; }
  .btn-cancel:disabled { opacity: 0.6; cursor: default; }
</style>
