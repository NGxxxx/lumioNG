<script lang="ts">
  import { untrack } from "svelte";
  import { insertDocument, replaceDocument } from "../api/documents";
  import { errorMessage } from "../api/errors";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { activeDocumentForm, type DocumentFormHandle } from "../stores/activeDocumentForm.svelte";
  import { idJson } from "../domain/docid";
  import type { Doc } from "../domain/doc";
  import { parseDocumentText } from "../domain/docparse";
  import { createDebouncer } from "../domain/timing";
  import { commandLog } from "../stores/commandLog.svelte";
  import { insertCmd, replaceCmd } from "../domain/mongosh";
  import { fieldsFor } from "../stores/fieldSuggestions";
  import { topLevelFieldNames } from "../domain/schema";
  import TreeEditor from "./TreeEditor.svelte";
  import { settings } from "../stores/settings.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    mode,
    db,
    coll,
    initial,
    active = false,
    onsaved,
    oncancel,
  }: {
    mode: "insert" | "edit";
    db: string;
    coll: string;
    initial: Doc | null;
    active?: boolean;
    onsaved: () => void;
    oncancel: () => void;
  } = $props();

  // Source of truth: tree object cloned from initial via structuredClone($state.snapshot(...)); $state.raw since docValue is always reassigned wholesale.
  let docValue = $state.raw<Doc>(
    untrack(() => structuredClone($state.snapshot(initial) ?? ({} as Doc))),
  );
  // Raw JSON text is derived from docValue lazily — never needed if the user stays on the Tree tab; previously recomputed on every tab switch.
  let text = $state("");
  let textDirty = $state(true); // text hasn't been derived from docValue yet
  let treeDirty = $state(false); // docValue hasn't been derived from (edited) text yet
  let view = $state<"tree" | "raw">("tree");
  let treeValid = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);
  const idText = $derived(mode === "edit" && initial ? idJson(initial) : null);

  const fieldCount = $derived(Object.keys(docValue).length);
  // db/coll are immutable for this component's instance lifetime (a new DocumentForm is mounted
  // rather than reused across a different document/collection), so this fetch runs once at
  // creation, no $effect needed.
  let fieldSuggestions = $state<string[]>([]);
  untrack(() => fieldsFor(sessionManager.active?.id ?? "", db, coll)).then((paths) => {
    // "_id" is always locked (see TreeEditor's default lockedKeys) — never worth offering as a
    // name for a NEW field.
    fieldSuggestions = topLevelFieldNames(paths, ["_id"]);
  });
  // Debounced rather than a plain $derived (see scheduleRecompute below) — a full JSON.parse on
  // every keystroke scales with document size; 500ms of typing pause is a fine trade for a huge doc.
  let jsonValid = $state(true);

  // Gutter is a separate div, so it needs its scroll synced to the textarea's.
  let gutterEl = $state<HTMLDivElement | null>(null);
  function syncGutterScroll(e: Event) {
    if (gutterEl) gutterEl.scrollTop = (e.currentTarget as HTMLTextAreaElement).scrollTop;
  }

  // Wrap mode: the gutter repeats blank rows under a wrapped line's number, measured via a hidden mirror div (word-wrap isn't a fixed column count).
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let mirrorEl = $state<HTMLDivElement | null>(null);
  let gutterLines = $state("1");

  // Above this many lines, skip wrap-aware measurement (one reflow per line would hang) — gutter stays simple/sequential past this size.
  const GUTTER_WRAP_LINE_CAP = 3000;

  function recomputeGutterLines() {
    const rawLines = text.split("\n");
    if (!settings.wrapLongLines || rawLines.length > GUTTER_WRAP_LINE_CAP || !mirrorEl || !textareaEl) {
      gutterLines = rawLines.map((_, i) => `${i + 1}`).join("\n");
      return;
    }
    const cs = getComputedStyle(textareaEl);
    const contentWidth = textareaEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    mirrorEl.style.width = `${contentWidth}px`;
    mirrorEl.replaceChildren(
      ...rawLines.map((line) => {
        const div = document.createElement("div");
        div.textContent = line === "" ? " " : line; // empty line still needs measurable height
        return div;
      }),
    );
    const lineHeightPx = parseFloat(getComputedStyle(mirrorEl).lineHeight) || 1;
    const rows: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      rows.push(`${i + 1}`);
      const visualRows = Math.max(1, Math.round(mirrorEl.children[i].getBoundingClientRect().height / lineHeightPx));
      for (let r = 1; r < visualRows; r++) rows.push("");
    }
    gutterLines = rows.join("\n");
  }

  // Both the gutter measurement and JSON validity check scale with document size, so debounce 500ms after typing stops.
  const RECOMPUTE_DEBOUNCE_MS = 500;
  const recomputeDebouncer = createDebouncer(RECOMPUTE_DEBOUNCE_MS);

  function recomputeNow() {
    recomputeDebouncer.cancel();
    recomputeGutterLines();
    jsonValid = view === "raw" ? parseDocumentText(text).ok : true;
  }

  function scheduleRecompute() {
    recomputeDebouncer.schedule(recomputeNow);
  }

  // Cancel a pending debounced recompute if the form is closed (Cancel/Save) mid-debounce —
  // otherwise it fires ~500ms later against a form that's already gone.
  $effect(() => {
    return () => recomputeDebouncer.cancel();
  });

  // Wrap is a discrete toggle (Toolbar's Wrap button), not a fast-repeating stream like keystrokes
  // — recompute immediately so the gutter reflows right when the user flips it, not 500ms later.
  $effect(() => {
    settings.wrapLongLines;
    recomputeNow();
  });

  $effect(() => {
    if (!textareaEl) return;
    // jsdom (unit tests) has no ResizeObserver; wrap-mode alignment there just skips live resize.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scheduleRecompute());
    ro.observe(textareaEl);
    return () => ro.disconnect();
  });

  function toRaw() {
    if (textDirty) {
      text = JSON.stringify(docValue, null, 2);
      textDirty = false;
    }
    error = null;
    view = "raw";
    recomputeNow();
  }

  function toTree() {
    if (treeDirty) {
      const r = parseDocumentText(text);
      if (!r.ok) {
        error = r.detail ? `${msgKey(r.error)}: ${r.detail}` : msgKey(r.error);
        return;
      }
      docValue = r.doc;
      treeDirty = false;
    }
    error = null;
    treeValid = true;
    view = "tree";
    jsonValid = true;
  }

  async function save() {
    if (saving || (view === "tree" && !treeValid)) return;
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
      treeDirty = false;
    } else {
      payload = docValue;
    }

    const docJson = JSON.stringify(payload);
    try {
      saving = true;
      const sid = sessionManager.active?.id ?? "";
      if (mode === "insert") {
        await commandLog.pushTimed(insertCmd(coll, docJson), sid, () =>
          insertDocument(sid, db, coll, docJson));
      } else {
        if (idText === null) {
          error = m.document_form_no_id_error();
          return;
        }
        await commandLog.pushTimed(replaceCmd(coll, idText, docJson), sid, () =>
          replaceDocument(sid, db, coll, idText, docJson));
      }
      onsaved();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  // Bridge for the global toolbar's Save button: only the currently active work tab registers.
  $effect(() => {
    if (!active) return;
    const h: DocumentFormHandle = {
      get canSave() {
        return !saving && (view !== "tree" || treeValid);
      },
      save,
    };
    activeDocumentForm.register(h);
    return () => activeDocumentForm.unregister(h);
  });
</script>

<div class="form">
  <header>
    <!-- Pencil icon -->
    <svg width="15" height="15" viewBox="0 0 16 16" class="header-icon" aria-hidden="true">
      <path d="M2 11l7-7 3 3-7 7H2z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.9"/>
      <path d="M10 3l2-2 3 3-2 2z" fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8"/>
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
        onchange={(v) => { docValue = v; textDirty = true; }}
        onvalidchange={(valid) => (treeValid = valid)}
        {fieldSuggestions}
      />
    {:else}
      <div class="json-area">
        <div class="gutter" bind:this={gutterEl} aria-hidden="true">{gutterLines}</div>
        <textarea
          bind:this={textareaEl}
          bind:value={text}
          spellcheck="false"
          class="json-textarea"
          class:wrap={settings.wrapLongLines}
          onscroll={syncGutterScroll}
          oninput={() => { treeDirty = true; scheduleRecompute(); }}
        ></textarea>
        <div class="gutter-mirror" bind:this={mirrorEl} aria-hidden="true"></div>
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
    background: var(--bg);
    font-family: inherit;
  }

  /* Header */
  header {
    display: flex;
    align-items: center;
    height: 2.125rem;
    flex: none;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
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
    background: var(--th-grad-top);
    border-bottom: 1px solid var(--border);
    padding: 0 0.625rem;
    gap: 0.125rem;
  }
  .subtab {
    padding: 0.1875rem 0.6875rem;
    color: var(--th-fg);
    cursor: pointer;
    background: transparent;
    border: none;
    font-size: var(--fs);
    font-weight: 400;
    border-radius: 0.1875rem 0.1875rem 0 0;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .subtab-active {
    background: var(--panel);
    border: 1px solid var(--gray-cf);
    border-bottom: 1px solid var(--panel);
    margin-bottom: -1px;
    font-weight: 600;
    color: var(--fg);
  }

  /* Editor body */
  .editor-body {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
    background: var(--cream);
  }

  /* Only the textarea scrolls; the gutter's scrollTop is synced to it (see syncGutterScroll). */
  .json-area {
    position: relative;
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
  }
  /* Off-screen mirror for measuring each line's actual wrapped height (see recomputeGutterLines). */
  .gutter-mirror {
    position: absolute;
    visibility: hidden;
    left: -9999px;
    top: 0;
    box-sizing: border-box;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
  }
  .gutter {
    box-sizing: border-box;
    width: 2.5rem;
    flex: none;
    text-align: right;
    color: var(--gray-b8);
    padding: 0.625rem 0.5rem 0 0;
    user-select: none;
    border-right: 1px solid var(--bg);
    background: var(--cream);
    white-space: pre;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
    overflow: hidden;
  }
  .json-textarea {
    /* border-box: else padding adds onto height:100%, overflowing .json-area and clipping the last line. */
    box-sizing: border-box;
    flex: 1;
    height: 100%;
    border: none;
    padding: 0.625rem 0.875rem;
    font-family: Consolas, "Courier New", ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
    resize: none;
    outline: none;
    background: var(--cream);
    color: var(--fg);
    white-space: pre;
    overflow-wrap: normal;
    overflow: auto;
  }
  /* Opt-in wrap mode (Toolbar's Wrap toggle): wraps instead of scrolling horizontally. */
  .json-textarea.wrap {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    overflow-x: hidden;
  }

  /* Error */
  .error {
    background: var(--error-bg);
    color: var(--error);
    padding: 0.375rem 0.875rem;
    font-size: var(--fs);
    flex: none;
  }

  /* Footer */
  footer {
    display: flex;
    align-items: center;
    height: 2.875rem;
    flex: none;
    border-top: 1px solid var(--gray-cf);
    padding: 0 0.75rem;
    gap: 0.5rem;
    background: var(--panel);
  }
  .footer-status {
    color: var(--muted);
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
    background: var(--run);
    color: var(--panel);
    border: none;
    border-radius: 0.1875rem;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8125rem;
  }
  .btn-save:hover:not(:disabled) { background: var(--run-hover); }
  .btn-save:disabled { opacity: 0.6; cursor: default; }
  .btn-cancel {
    display: flex;
    align-items: center;
    height: 1.75rem;
    padding: 0 1.25rem;
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--gray-b8);
    border-radius: 0.1875rem;
    cursor: pointer;
    font-size: 0.8125rem;
  }
  .btn-cancel:hover:not(:disabled) { background: var(--bg); }
  .btn-cancel:disabled { opacity: 0.6; cursor: default; }
</style>
