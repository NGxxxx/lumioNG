<!-- src/lib/components/DocPeekDrawer.svelte — quick-look drawer over the grid: view / edit a document, diff before save. Rendering only; state lives in stores/docPeek. -->
<script lang="ts">
  import type { DocPeek } from "../stores/docPeek.svelte";
  import type { Doc } from "../domain/doc";
  import { flattenDocs } from "../domain/treeFlatten";
  import { describeValue, truncateForDisplay } from "../domain/extjson";
  import { previewCell } from "../domain/cellPreview";
  import { formatChange } from "../domain/docDiff";
  import { idJson } from "../domain/docid";
  import { followableValue } from "../domain/refTarget";
  import { PEEK_MIN_W } from "../stores/settings.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import TreeEditor from "./TreeEditor.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import { msgCount } from "#lib/msgkey.js";

  let {
    peek,
    pinned,
    width,
    selectionCount,
    onresize,
    onpin,
    onopentab,
    onduplicate,
    ondelete,
    onbulk,
    canDuplicate = true,
    onref,
    onopenreftab,
  }: {
    peek: DocPeek;
    pinned: boolean;
    width: number;
    selectionCount: number;
    onresize: (px: number) => void;
    onpin: (pinned: boolean) => void;
    onopentab: (d: Doc) => void;
    onduplicate: (d: Doc) => void;
    ondelete: () => void;
    onbulk: (action: "copy" | "export" | "delete") => void;
    /** False where a copy can't be inserted (query results with no single source). */
    canDuplicate?: boolean;
    /** Follow an ObjectId / DBRef shown in the drawer (field path relative to the document). */
    onref?: (path: string, value: unknown, anchor: { x: number; y: number } | null) => void;
    /** Open the referenced document's own collection in a Data tab, filtered to it. */
    onopenreftab?: (source: { db: string; coll: string }, doc: Doc) => void;
  } = $props();

  const fieldPath = (rowPath: string) => rowPath.replace(/^#\d+\.?/, "");
  const refSource = $derived(peek.isRef && peek.source?.db && peek.source?.coll ? { db: peek.source.db, coll: peek.source.coll } : null);

  function onDrawerKey(e: KeyboardEvent) {
    if (!peek.canBack || peek.mode === "edit") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) {
      e.preventDefault();
      peek.back();
    }
  }

  function goRef(e: MouseEvent, rowPath: string, value: unknown) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onref?.(fieldPath(rowPath), followableValue(fieldPath(rowPath), value), { x: r.left, y: r.bottom });
  }

  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));

  let tab = $state<"fields" | "json">("fields");
  let open = $state<Set<string>>(new Set(["#0"]));
  let diffOpen = $state(false);
  let treeValid = $state(true);
  let el: HTMLElement | undefined = $state();

  const rows = $derived(peek.doc ? flattenDocs([peek.doc], open).filter((r) => r.depth > 0) : []);
  // Full text for copying; the on-screen copy is capped (a multi-MB field must not land in the DOM).
  const json = $derived(peek.doc ? JSON.stringify(peek.doc, null, 2) : "");
  const jsonShown = $derived(truncateForDisplay(json));
  const shortId = $derived.by(() => {
    const id = peek.doc ? idJson(peek.doc) : null;
    if (id === null) return null;
    const oid = (peek.doc!._id as { $oid?: string })?.$oid;
    const text = oid ?? id;
    return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-3)}` : text;
  });

  function toggle(path: string) {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    open = next;
  }

  function valueText(v: unknown): string {
    return typeof v === "string" ? truncateForDisplay(JSON.stringify(v.length > 20_000 ? v.slice(0, 20_000) : v)) : previewCell(v).text;
  }

  // Drag the left edge to resize; the maximum is half of the grid region the drawer sits in.
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const max = Math.max(PEEK_MIN_W, (el?.parentElement?.clientWidth ?? 2 * startW) / 2);
    const move = (ev: PointerEvent) => onresize(Math.min(max, Math.max(PEEK_MIN_W, startW + (startX - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="drawer" class:pinned bind:this={el} style="width:{width}px" aria-label={m.peek_title()} onkeydown={onDrawerKey}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize" onpointerdown={startResize}></div>

  <header>
    <span class="title">{m.peek_title()}</span>
    {#if shortId}
      <button class="id" onclick={() => peek.doc && copy(idJson(peek.doc) ?? "")} title={m.peek_copy_id()} aria-label={m.peek_copy_id()}>{shortId}</button>
    {/if}
    <span class="spacer"></span>
    {#if peek.doc && !peek.isRef}
      <button class="icon" aria-label={m.peek_open_tab()} title={m.peek_open_tab()} onclick={() => peek.doc && onopentab(peek.doc)}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 2.5h4.5V7M13.5 2.5L8 8M6.5 3.5h-4v10h10v-4" /></svg>
      </button>
    {/if}
    <button class="icon" class:on={pinned} aria-label={pinned ? m.peek_unpin() : m.peek_pin()} title={pinned ? m.peek_unpin() : m.peek_pin()} aria-pressed={pinned} onclick={() => onpin(!pinned)}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" /></svg>
    </button>
    <button class="icon" aria-label={m.peek_close()} title={m.peek_close()} onclick={() => peek.requestClose()}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>
  </header>

  {#if peek.crumbs.length}
    <nav class="crumbs" aria-label={m.ref_follow()}>
      <button class="back" onclick={() => peek.back()} disabled={peek.dirty} aria-label={m.ref_back()} title={m.ref_back()}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 8H3.5M7 4.5L3.5 8 7 11.5" /></svg>
      </button>
      <span class="trail">
        {#each peek.crumbs as c, i (i)}
          {#if i > 0}<span class="sep">→</span>{/if}
          <span class="coll">{c.coll}</span>{#if c.via}<span class="via">› {c.via}</span>{:else if c.idTail}<span class="via">/ …{c.idTail}</span>{/if}
        {/each}
      </span>
    </nav>
  {/if}

  {#if selectionCount > 1 && !peek.dirty && !peek.isRef}
    <div class="bulk">
      <p>{msgCount("peek_selected_count", selectionCount)}</p>
      <div class="bulk-actions">
        <button class="btn" onclick={() => onbulk("copy")}>{m.peek_copy_json()}</button>
        <button class="btn" onclick={() => onbulk("export")}>{m.peek_export_selection()}</button>
        <button class="btn danger" onclick={() => onbulk("delete")}>{m.peek_delete_selected()}</button>
      </div>
    </div>
  {:else}
    {#if peek.mode === "view"}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "fields"} class:active={tab === "fields"} onclick={() => (tab = "fields")}>{m.peek_fields()}</button>
        <button role="tab" aria-selected={tab === "json"} class:active={tab === "json"} onclick={() => (tab = "json")}>JSON</button>
      </div>
    {/if}

    <div class="body">
      {#if selectionCount > 1}<div class="note">{m.peek_still_editing()}</div>{/if}
      {#if peek.stale}<div class="note">{m.peek_stale_note()}</div>{/if}
      {#if peek.error}
        <div class="error">
          <span>{peek.error}</span>
          {#if !peek.doc && !peek.loading}<button class="btn" onclick={() => peek.retry()}>{m.peek_retry()}</button>{/if}
        </div>
      {/if}
      {#if peek.loading}
        {#each { length: 8 } as _, i (i)}<div class="skeleton" style="width:{55 + ((i * 17) % 40)}%"></div>{/each}
      {:else if peek.doc && peek.mode === "edit" && peek.draft}
        <TreeEditor value={peek.draft} onchange={(d) => peek.setDraft(d)} onvalidchange={(v) => (treeValid = v)} compact />
      {:else if peek.doc && tab === "json"}
        <div class="json-wrap">
          <button class="btn copy-json" onclick={() => copy(json)}>{m.cell_copy()}</button>
          <pre>{jsonShown}</pre>
        </div>
      {:else if peek.doc}
        <div class="fields">
          {#each rows as r (r.path)}
            {@const type = describeValue(r.value).type}
            <div class="kv" style="padding-left:{(r.depth - 1) * 0.875}rem">
              {#if r.expandable}
                <button class="key toggle" aria-expanded={open.has(r.path)} onclick={() => toggle(r.path)}>
                  <svg aria-hidden="true" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2">
                    {#if open.has(r.path)}<path d="M4 6l4 4 4-4" />{:else}<path d="M6 4l4 4-4 4" />{/if}
                  </svg>{r.key}
                </button>
                <span class="val dim">{type === "array" ? `[ ${r.childCount} ]` : `{ ${r.childCount} }`}{#if onref && type !== "array" && followableValue(fieldPath(r.path), r.value) !== null}<button class="ref-go" aria-label={m.ref_follow()} title={m.ref_follow()} onclick={(e) => goRef(e, r.path, r.value)}>→</button>{/if}</span>
              {:else}
                <span class="key">{r.key}</span>
                <span class="val {type}">{valueText(r.value)}{#if onref && followableValue(fieldPath(r.path), r.value) !== null}<button class="ref-go" aria-label={m.ref_follow()} title={m.ref_follow()} onclick={(e) => goRef(e, r.path, r.value)}>→</button>{/if}</span>
              {/if}
              <span class="type">{type}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if peek.mode === "edit"}
      <div class="diff">
        {#if peek.changes.length > 0}
          <button class="diff-toggle" aria-expanded={diffOpen} onclick={() => (diffOpen = !diffOpen)}>
            {peek.changes.length === 1 ? m.peek_changes_one() : m.peek_changes_other({ count: peek.changes.length })}
          </button>
          {#if diffOpen}
            <ul class="changes">
              {#each peek.changes as c (c.path)}<li class={c.kind}>{formatChange(c)}</li>{/each}
            </ul>
          {/if}
        {:else}
          <span class="dim">{m.peek_no_changes()}</span>
        {/if}
      </div>
    {/if}

    {#if peek.confirm}
      <div class="confirm" role="alertdialog" aria-label={m.peek_dirty_message()}>
        <span>{m.peek_dirty_message()}</span>
        <button class="btn primary" onclick={() => peek.confirmSave()} disabled={peek.saving}>{m.peek_save()}</button>
        <button class="btn" onclick={() => peek.confirmDiscard()}>{m.peek_discard()}</button>
        <button class="btn ghost" onclick={() => peek.confirmStay()}>{m.peek_stay()}</button>
      </div>
    {:else if peek.doc}
      <footer>
        {#if peek.mode === "edit"}
          <button class="btn primary" onclick={() => peek.save()} disabled={peek.saving || peek.changes.length === 0 || !treeValid}>{m.peek_save()}</button>
          <button class="btn" onclick={() => peek.discard()}>{m.peek_discard()}</button>
        {:else}
          {#if peek.canEdit}<button class="btn" onclick={() => peek.startEdit()}>{m.peek_edit()}</button>{/if}
          {#if refSource}
            <!-- A referenced document lives in another collection: the host's duplicate/delete would act on the wrong one. -->
            {#if onopenreftab}<button class="btn" onclick={() => refSource && peek.doc && onopenreftab(refSource, peek.doc)}>{m.ref_open_tab({ coll: refSource.coll })}</button>{/if}
          {:else}
            {#if canDuplicate}<button class="btn" onclick={() => peek.doc && onduplicate(peek.doc)}>{m.peek_duplicate()}</button>{/if}
            {#if peek.canEdit}<button class="btn danger" aria-label={m.peek_delete()} onclick={ondelete}>{m.peek_delete()}</button>{/if}
          {/if}
        {/if}
      </footer>
    {/if}
  {/if}
</aside>

<style>
  .crumbs { display: flex; align-items: center; gap: 0.375rem; padding: 0.3125rem 0.625rem; border-bottom: 1px solid var(--border); font-size: 0.6875rem; color: var(--muted); }
  .crumbs .back { display: inline-flex; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; padding: 0; border: 1px solid var(--c-surface1); border-radius: var(--radius-sm); background: none; color: var(--fg); cursor: pointer; flex: none; }
  .crumbs .back:disabled { opacity: 0.4; cursor: default; }
  .trail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trail .coll { color: var(--fg); font-family: var(--mono); }
  .trail .sep { margin: 0 0.25rem; }
  .trail .via { margin-left: 0.25rem; }
  .ref-go { margin-left: 0.25rem; padding: 0 0.3125rem; border: 1px solid var(--c-surface1); border-radius: var(--radius-sm); background: none; color: var(--accent); cursor: pointer; font-size: 0.6875rem; line-height: 1.2; }
  .ref-go:hover { background: var(--menu-hover); }
  .drawer {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: 8; display: flex; flex-direction: column; min-width: 0;
    background: var(--popover); border-left: 1px solid var(--c-surface1); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.18);
    animation: slide-in 0.14s ease-out;
  }
  .drawer.pinned { position: relative; box-shadow: none; animation: none; flex: none; }
  @keyframes slide-in { from { transform: translateX(1.5rem); opacity: 0; } to { transform: none; opacity: 1; } }
  .resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 1; }
  .resize:hover { background: color-mix(in srgb, var(--accent) 35%, transparent); }

  header { display: flex; align-items: center; gap: 0.375rem; height: 2.625rem; padding: 0 0.375rem 0 0.875rem; border-bottom: 1px solid var(--border); flex: none; }
  .title { font-weight: 600; font-size: var(--fs); }
  .id { border: none; background: none; padding: 0.125rem 0.25rem; border-radius: var(--radius-sm); font-family: var(--mono); font-size: 0.71875rem; color: var(--muted); cursor: pointer; }
  .id:hover { background: var(--hover); color: var(--fg); }
  .spacer { flex: 1; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border: none; border-radius: var(--radius); background: none; color: var(--muted); cursor: pointer; }
  .icon:hover, .icon.on { background: var(--menu-hover); color: var(--fg); }
  .icon.on { color: var(--accent); }

  .tabs { display: flex; gap: 1rem; padding: 0 0.875rem; border-bottom: 1px solid var(--border); flex: none; }
  .tabs button { height: 2.125rem; padding: 0; border: none; background: none; color: var(--muted); font-size: 0.78125rem; cursor: pointer; }
  .tabs button.active { color: var(--fg); box-shadow: inset 0 -2px 0 var(--accent); }

  .body { flex: 1; min-height: 0; overflow: auto; padding: 0.375rem 0.875rem 0.875rem; }
  .note { margin: 0.375rem 0; padding: 0.375rem 0.5rem; border-radius: var(--radius); background: var(--warn-bg); color: var(--warn-fg); font-size: 0.75rem; }
  .error { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin: 0.375rem 0; padding: 0.375rem 0.5rem; border-radius: var(--radius); background: var(--error-bg); color: var(--error); font-size: 0.75rem; }
  .skeleton { height: 0.625rem; margin: 0.875rem 0; border-radius: 0.25rem; background: color-mix(in srgb, var(--c-text) 7%, transparent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

  .kv { display: grid; grid-template-columns: minmax(6rem, 40%) minmax(0, 1fr) auto; gap: 0.625rem; align-items: baseline; padding-top: 0.375rem; padding-bottom: 0.375rem; border-bottom: 1px solid var(--row-divider); font-size: 0.78125rem; }
  .key { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toggle { display: inline-flex; align-items: center; gap: 0.25rem; border: none; background: none; padding: 0; font: inherit; text-align: left; cursor: pointer; }
  .toggle:hover { color: var(--fg); }
  .val { font-family: var(--mono); font-size: 0.75rem; overflow-wrap: anywhere; color: var(--fg); }
  .val.string { color: var(--j-string); }
  .val.int, .val.long, .val.double, .val.decimal { color: var(--j-number); }
  .val.bool { color: var(--j-bool); }
  .val.null { color: var(--c-overlay2); font-style: italic; }
  .dim { color: var(--muted); }
  .type { font-family: var(--mono); font-size: 0.65625rem; color: var(--c-overlay1); }

  .json-wrap { position: relative; }
  .copy-json { position: absolute; top: 0.375rem; right: 0; }
  pre { margin: 0.375rem 0 0; font-family: var(--mono); font-size: 0.75rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }

  .diff { flex: none; padding: 0.5rem 0.875rem; border-top: 1px solid var(--border); font-size: 0.75rem; }
  .diff-toggle { border: none; background: none; padding: 0; color: var(--accent); font: inherit; font-weight: 500; cursor: pointer; }
  .changes { list-style: none; margin: 0.375rem 0 0; padding: 0; max-height: 9rem; overflow: auto; font-family: var(--mono); font-size: 0.71875rem; }
  .changes li { padding: 0.125rem 0; color: var(--c-subtext1); }
  .changes li.added { color: var(--ok-fg); }
  .changes li.removed { color: var(--danger); }

  footer, .confirm { display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--border); flex: none; }
  .confirm { flex-wrap: wrap; font-size: 0.75rem; color: var(--c-subtext1); }
  .confirm span { flex: 1 1 100%; }
  .btn { height: 1.875rem; padding: 0 0.75rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--hover); color: var(--fg); font-size: var(--fs); cursor: pointer; }
  footer .btn { flex: 1; }
  .btn:hover:not(:disabled) { background: var(--menu-hover); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn.primary { background: var(--run); border-color: transparent; color: var(--on-accent); font-weight: 600; }
  .btn.danger { flex: none; background: transparent; color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, var(--c-surface1)); }
  .btn.ghost { background: none; border-color: transparent; color: var(--muted); }

  /* Compact tree editor: the "add field" row stays on one line at the drawer's default width. */
  .body :global(.add) { flex-wrap: nowrap; min-width: 0; }
  .body :global(.add .name) { flex: 1 1 4rem; min-width: 3rem; width: auto; }
  .body :global(.add select) { max-width: 5.5rem; }
  .body :global(.add button) { white-space: nowrap; }
  .bulk { padding: 1rem 0.875rem; }
  .bulk p { margin: 0 0 0.75rem; font-weight: 500; }
  .bulk-actions { display: flex; flex-direction: column; gap: 0.5rem; }
</style>
