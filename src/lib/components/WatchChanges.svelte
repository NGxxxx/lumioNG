<!-- Watch tab, "Data changes" mode: change-stream events on the left, the selected change and its
     document's history on the right. Shared look lives in WatchTab.svelte. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { WatchTab } from "../stores/navigation.svelte";
  import type { Watch } from "../stores/watch.svelte";
  import { CHANGE_OPS, eventChanges, eventSummary, formatClock, type ChangeEvent, type ChangeOp } from "../domain/changeEvents";
  import { describeValue, truncateForDisplay } from "../domain/extjson";
  import { formatCount } from "../domain/stats";
  import { createFollowList } from "./followList.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import { errorMessage } from "../api/errors";
  import type { Doc } from "../domain/doc";
  import WatchNotice from "./WatchNotice.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tab, w, switcher, scopeLabel, onopendocument }: {
    tab: WatchTab;
    w: Watch;
    switcher: Snippet;
    scopeLabel: string;
    onopendocument: (db: string, coll: string, doc: Doc) => void;
  } = $props();

  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));
  // Namespace column only when several collections can show up.
  const showNs = $derived(tab.coll === null);

  const OP_LABEL: Record<ChangeOp, () => string> = {
    insert: m.watch_op_insert,
    update: m.watch_op_update,
    replace: m.watch_op_replace,
    delete: m.watch_op_delete,
    other: m.watch_op_other,
  };
  const opText = (e: ChangeEvent) => (e.op === "other" ? e.opType : OP_LABEL[e.op]());

  const ROW_H = 26;
  const list = createFollowList({ count: () => w.visible.length, rowHeight: ROW_H });

  function selectAt(i: number) {
    const e = w.visible[i];
    if (!e) return;
    w.select(e.seq);
    list.reveal(i);
  }

  function onListKey(e: KeyboardEvent) {
    const idx = w.selected ? w.visible.findIndex((x) => x.seq === w.selected!.seq) : -1;
    if (e.key === "ArrowDown" || e.key === "j") selectAt(Math.min(w.visible.length - 1, idx + 1));
    else if (e.key === "ArrowUp" || e.key === "k") selectAt(Math.max(0, idx - 1));
    else if (e.key === "End") { list.jumpToLatest(); return; }
    else if (e.key === "Home") selectAt(0);
    else return;
    e.preventDefault();
  }

  type DetailView = "changes" | "history" | "json";
  let detailView = $state<DetailView>("changes");
  const sel = $derived(w.selected);
  const changes = $derived(sel ? eventChanges(sel) : []);

  function show(v: unknown): string {
    if (v === undefined) return "";
    const d = describeValue(v);
    return d.type === "string" ? JSON.stringify(truncateForDisplay(d.display, 400)) : truncateForDisplay(d.display, 400);
  }
  const pretty = (d: unknown) => truncateForDisplay(JSON.stringify(d, null, 2), 200_000);
  /** Compact _id: ObjectIds keep both ends (creation time … counter), which is what tells them apart. */
  function idLabel(e: ChangeEvent): string {
    if (e.id === undefined) return "";
    const d = describeValue(e.id);
    return d.type === "objectId" && d.display.length === 24 ? `${d.display.slice(0, 8)}…${d.display.slice(-6)}` : d.display;
  }
  const idFull = (e: ChangeEvent) => (e.id === undefined ? "" : describeValue(e.id).display);

  async function openCurrent(e: ChangeEvent) {
    try {
      const doc = await w.currentDocument(e);
      const dot = e.ns.indexOf(".");
      if (doc) onopendocument(e.ns.slice(0, dot), e.ns.slice(dot + 1), doc);
      else toast.push(m.watch_doc_gone(), "error");
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  async function exportRecording() {
    try {
      const path = await w.exportToFile();
      if (path) toast.push(m.watch_exported({ count: w.events.length }));
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  const recording = $derived(w.status === "recording" || w.status === "starting");
  const blocked = $derived(w.status === "standalone" || (w.status === "error" && w.denied));
</script>

<div class="bar">
  {@render switcher()}
  <span class="state" class:live={w.status === "recording"}>
    <span class="dot" aria-hidden="true"></span>
    {#if w.status === "recording"}{m.watch_status_recording()}
    {:else if w.status === "starting"}{m.watch_status_starting()}
    {:else if w.status === "paused"}{m.watch_status_paused()}
    {:else if w.status === "ended"}{m.watch_status_ended()}
    {:else if blocked}{m.watch_status_unavailable()}
    {:else}{m.watch_status_stopped()}{/if}
  </span>
  {#if tab.idText}<span class="doc-scope" title={tab.idText}>_id {truncateForDisplay(tab.idText, 40)}</span>{/if}
  <div class="spacer"></div>
  <button class="btn" class:rec={!recording} onclick={() => w.toggle()} disabled={blocked}>
    {#if recording}
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="0.5" fill="currentColor" /><rect x="9.5" y="3" width="3" height="10" rx="0.5" fill="currentColor" /></svg>{m.watch_pause()}
    {:else}
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="currentColor" /></svg>{m.watch_record()}
    {/if}
  </button>
  <button class="btn" onclick={() => w.clear()} disabled={!w.events.length}>{m.watch_clear()}</button>
  <button class="btn" onclick={exportRecording} disabled={!w.events.length}>{m.watch_export()}</button>
</div>

{#if w.status === "standalone"}
  <WatchNotice icon="blocked" title={m.watch_standalone_title()} body={m.watch_standalone_body()}>
    <pre class="cmd">mongod --replSet rs0 …
mongosh --eval "rs.initiate()"</pre>
    <button class="btn" onclick={() => w.start()}>{m.watch_retry()}</button>
  </WatchNotice>
{:else if w.status === "error" && w.denied}
  <WatchNotice icon="lock" title={m.watch_changes_denied_title()} body={m.watch_changes_denied_body({ scope: scopeLabel })} detail={w.error}>
    <button class="btn" onclick={() => w.start()}>{m.watch_retry()}</button>
  </WatchNotice>
{:else}
  {#if w.error}
    <div class="error" role="alert">{w.error} <button class="link" onclick={() => w.start()}>{m.watch_retry()}</button></div>
  {/if}
  {#if w.dropped}
    <div class="info">{m.watch_dropped({ count: formatCount(w.dropped) })}</div>
  {/if}
  <div class="split">
    <div class="list">
      <div class="filters">
        <div class="chips" role="group" aria-label={m.watch_filter_ops()}>
          {#each CHANGE_OPS as op (op)}
            <button
              class="chip op-{op}"
              class:off={!w.ops.has(op)}
              aria-pressed={w.ops.has(op)}
              title={m.watch_op_chip_hint()}
              onclick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? w.soloOp(op) : w.toggleOp(op))}
              ondblclick={() => w.soloOp(op)}
            >{OP_LABEL[op]()}<span class="n">{formatCount(w.counts[op])}</span></button>
          {/each}
        </div>
        <input class="search" bind:value={w.text} placeholder={m.watch_search_placeholder()} aria-label={m.watch_search_placeholder()} spellcheck="false" />
      </div>
      <div class="row head cols" class:with-ns={showNs} aria-hidden="true">
        <span>{m.watch_col_time()}</span><span>{m.watch_col_op()}</span>
        {#if showNs}<span>{m.watch_col_ns()}</span>{/if}
        <span>_id</span><span>{m.watch_col_changes()}</span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroller" bind:this={list.scroller} onscroll={list.onScroll} onkeydown={onListKey} tabindex="0" role="listbox" aria-label={m.watch_events_label()}>
        {#if !w.visible.length}
          <div class="empty">
            {#if w.events.length}{m.watch_no_match()}
            {:else if recording}<span class="pulse" aria-hidden="true"></span>{m.watch_waiting({ scope: scopeLabel })}
            {:else}{m.watch_paused_empty()}{/if}
          </div>
        {:else}
          <div style="height:{list.total}px; position:relative">
            {#each list.items as it (it.key)}
              {@const e = w.visible[it.index]}
              {#if e}
                <div
                  class="row cols"
                  class:with-ns={showNs}
                  class:selected={sel?.seq === e.seq}
                  style="position:absolute; top:0; left:0; right:0; height:{ROW_H}px; transform:translateY({it.start}px)"
                  role="option"
                  aria-selected={sel?.seq === e.seq}
                  tabindex="-1"
                  onclick={() => { w.select(e.seq); list.hold(); }}
                  onkeydown={() => {}}
                >
                  <span class="time">{formatClock(e.time)}</span>
                  <span><span class="badge op-{e.op}">{opText(e)}</span></span>
                  {#if showNs}<span class="mono" title={e.ns}>{tab.db ? e.ns.slice(e.ns.indexOf(".") + 1) : e.ns}</span>{/if}
                  <span class="mono" title={e.idText === null ? "" : idFull(e)}>{idLabel(e)}</span>
                  <span class="sum" title={eventSummary(e)}>{eventSummary(e)}</span>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      {#if list.unseen > 0}
        <button class="new-pill" onclick={list.jumpToLatest}>↓ {m.watch_new_events({ count: formatCount(list.unseen) })}</button>
      {/if}
    </div>

    <div class="detail">
      {#if !sel}
        <div class="empty">{m.watch_select_hint()}</div>
      {:else}
        <div class="d-head">
          <span class="badge op-{sel.op}">{opText(sel)}</span>
          <span class="d-time" title={new Date(sel.time).toLocaleString()}>{formatClock(sel.time)}</span>
          <div class="spacer"></div>
          {#if sel.idText !== null}
            <button class="link" onclick={() => copy(sel.idText ?? "")}>{m.watch_copy_id()}</button>
            {#if sel.op !== "delete"}<button class="link" onclick={() => openCurrent(sel)}>{m.watch_open_doc()}</button>{/if}
          {/if}
        </div>
        <div class="d-sub" title={sel.idText ?? sel.ns}>
          {sel.ns}{#if sel.idText !== null}<span class="sep">·</span>_id {idFull(sel)}{/if}
        </div>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={detailView === "changes"} class:on={detailView === "changes"} onclick={() => (detailView = "changes")}>{m.watch_tab_changes()}</button>
          <button role="tab" aria-selected={detailView === "history"} class:on={detailView === "history"} onclick={() => (detailView = "history")} disabled={sel.idText === null}>{m.watch_tab_history({ count: w.history.length })}</button>
          <button role="tab" aria-selected={detailView === "json"} class:on={detailView === "json"} onclick={() => (detailView = "json")}>{m.watch_tab_json()}</button>
        </div>
        <div class="d-body">
          {#if detailView === "changes"}
            {#if sel.op === "insert"}
              <div class="caption">{m.watch_inserted_doc()}</div>
              <pre class="json">{pretty(sel.after)}</pre>
            {:else if sel.op === "delete"}
              {#if sel.before}
                <div class="caption">{m.watch_deleted_doc()}</div>
                <pre class="json removed">{pretty(sel.before)}</pre>
              {:else}
                <div class="caption">{m.watch_deleted_unknown()}</div>
              {/if}
            {:else if sel.op === "other"}
              <div class="caption">{m.watch_other_event({ type: sel.opType })}</div>
            {:else}
              {#if sel.beforeSource === "none"}
                <div class="caption warn">{w.preImages ? m.watch_before_unknown_preimages() : m.watch_before_unknown()}</div>
              {:else if sel.beforeSource === "preImage"}
                <div class="caption">{m.watch_before_from_preimage()}</div>
              {/if}
              {#if changes.length}
                <table class="diff">
                  <thead><tr><th>{m.watch_col_field()}</th><th>{m.watch_col_before()}</th><th>{m.watch_col_after()}</th></tr></thead>
                  <tbody>
                    {#each changes as c (c.path)}
                      <tr class="k-{c.kind}">
                        <td class="path">{c.path}</td>
                        <td class="before">{#if c.kind === "added"}<span class="none">—</span>{:else if sel.beforeSource === "none"}<span class="none">?</span>{:else}{show(c.before)}{/if}</td>
                        <td class="after">{#if c.kind === "removed"}<span class="none">{m.watch_removed()}</span>{:else}{show(c.after)}{/if}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {:else}
                <div class="caption">{m.watch_no_field_changes()}</div>
              {/if}
              {#if sel.after}
                <details>
                  <summary>{m.watch_doc_after()}</summary>
                  <pre class="json">{pretty(sel.after)}</pre>
                </details>
              {/if}
            {/if}
          {:else if detailView === "history"}
            <ol class="timeline">
              {#each w.history as h (h.seq)}
                <li class:current={h.seq === sel.seq}>
                  <button onclick={() => w.select(h.seq)}>
                    <span class="time">{formatClock(h.time)}</span>
                    <span class="badge op-{h.op}">{opText(h)}</span>
                    <span class="sum">{eventSummary(h)}</span>
                  </button>
                </li>
              {/each}
            </ol>
            <div class="caption">{m.watch_history_note()}</div>
          {:else}
            <pre class="json">{pretty(sel.raw)}</pre>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .doc-scope { font-family: var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14rem; }
  .cols { grid-template-columns: 6.5rem 5.5rem minmax(6rem, 0.8fr) minmax(8rem, 1.6fr); }
  .cols.with-ns { grid-template-columns: 6.5rem 5.5rem minmax(5rem, 0.7fr) minmax(6rem, 0.8fr) minmax(8rem, 1.4fr); }
  .op-insert { --op: var(--c-green); }
  .op-update { --op: var(--c-blue); }
  .op-replace { --op: var(--c-mauve); }
  .op-delete { --op: var(--c-red); }
  .op-other { --op: var(--c-overlay1); }
  .cmd { margin: 0; font-family: var(--mono); font-size: 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem 0.75rem; }
  .json.removed { color: var(--danger-mute); }
  details { margin-top: 0.75rem; }
  summary { cursor: pointer; color: var(--muted); font-size: 0.75rem; margin-bottom: 0.375rem; }
  .diff { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--mono); font-size: 0.75rem; }
  .diff th { text-align: left; font-family: var(--font); font-weight: 600; color: var(--th-fg); padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .diff th:first-child { width: 32%; }
  .diff td { padding: 0.3125rem 0.5rem; border-bottom: 1px solid var(--row-divider); vertical-align: top; word-break: break-word; }
  .diff .path { color: var(--j-key); }
  .diff .before { background: color-mix(in srgb, var(--c-red) 7%, var(--panel)); }
  .diff .after { background: color-mix(in srgb, var(--c-green) 8%, var(--panel)); }
  .diff .k-added .before, .diff .k-removed .after { background: none; }
  .none { color: var(--muted); font-style: italic; font-family: var(--font); }
  .timeline { list-style: none; margin: 0 0 0.75rem; padding: 0 0 0 0.5rem; border-left: 2px solid var(--border); }
  .timeline li { position: relative; }
  .timeline li::before {
    content: ""; position: absolute; left: -0.8125rem; top: 0.6875rem; width: 0.5rem; height: 0.5rem; border-radius: 50%;
    background: var(--panel); border: 2px solid var(--c-surface2);
  }
  .timeline li.current::before { border-color: var(--accent); background: var(--accent); }
  .timeline button {
    width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; border: 0; border-radius: var(--radius);
    background: none; color: var(--fg); text-align: left; cursor: pointer; font-size: var(--fs);
  }
  .timeline button:hover { background: var(--hover); }
  .timeline li.current button { background: var(--selected); }
  .timeline .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
