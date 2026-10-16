<!-- Watch tab, "Queries" mode: follows the database profiler while recording — how long each query
     took, whether it used an index, how much it read. Shared look lives in WatchTab.svelte. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { WatchTab } from "../stores/navigation.svelte";
  import type { QueryWatch } from "../stores/queryWatch.svelte";
  import { formatClock } from "../domain/changeEvents";
  import {
    QUERY_KINDS, speedOf, formatMillis, indexHint, querySummary, queryStatement, type QueryEntry, type QueryKind,
  } from "../domain/profileEntries";
  import { truncateForDisplay } from "../domain/extjson";
  import { formatCount } from "../domain/stats";
  import { createFollowList } from "./followList.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import { errorMessage } from "../api/errors";
  import WatchNotice from "./WatchNotice.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tab, q, switcher, onopenquery }: {
    tab: WatchTab;
    q: QueryWatch;
    switcher: Snippet;
    onopenquery: (statement: string) => void;
  } = $props();

  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));
  const showNs = $derived(tab.coll === null);

  const KIND_LABEL: Record<QueryKind, () => string> = {
    read: m.watch_q_kind_read,
    write: m.watch_q_kind_write,
    other: m.watch_q_kind_other,
  };
  const needsIndexCount = $derived(q.entries.reduce((n, e) => n + (indexHint(e) ? 1 : 0), 0));

  const ROW_H = 26;
  const list = createFollowList({ count: () => q.visible.length, rowHeight: ROW_H });

  function selectAt(i: number) {
    const e = q.visible[i];
    if (!e) return;
    q.select(e.seq);
    list.reveal(i);
  }

  function onListKey(e: KeyboardEvent) {
    const idx = q.selected ? q.visible.findIndex((x) => x.seq === q.selected!.seq) : -1;
    if (e.key === "ArrowDown" || e.key === "j") selectAt(Math.min(q.visible.length - 1, idx + 1));
    else if (e.key === "ArrowUp" || e.key === "k") selectAt(Math.max(0, idx - 1));
    else if (e.key === "End") { list.jumpToLatest(); return; }
    else if (e.key === "Home") selectAt(0);
    else return;
    e.preventDefault();
  }

  let detailView = $state<"command" | "json">("command");
  const sel = $derived(q.selected);
  const hint = $derived(sel ? indexHint(sel) : null);
  const statement = $derived(sel ? queryStatement(sel) : null);
  const pretty = (d: unknown) => truncateForDisplay(JSON.stringify(d, null, 2), 200_000);
  const n = (v: number | null) => (v === null ? "—" : formatCount(v));
  /** planSummary on one line, for the list column. */
  const planShort = (e: QueryEntry) => e.plan.replace(/\s+/g, " ") || "—";

  async function exportRecording() {
    try {
      const path = await q.exportToFile();
      if (path) toast.push(m.watch_exported({ count: q.entries.length }));
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  const recording = $derived(q.status === "recording" || q.status === "starting");
  const canToggle = $derived(q.status === "recording" || q.status === "starting" || q.status === "paused" || q.status === "error");
  const captureLabel = $derived(q.capture === "all" ? m.watch_q_capture_all_short() : m.watch_q_capture_slow_short({ ms: q.slowms }));
</script>

<div class="bar">
  {@render switcher()}
  <span class="state" class:live={q.status === "recording"}>
    <span class="dot" aria-hidden="true"></span>
    {#if q.status === "recording"}{m.watch_status_recording()}
    {:else if q.status === "starting"}{m.watch_status_starting()}
    {:else if q.status === "paused"}{m.watch_status_paused()}
    {:else if q.status === "unavailable"}{m.watch_status_unavailable()}
    {:else if q.status === "idle"}{m.watch_q_status_off()}
    {:else}{m.watch_status_stopped()}{/if}
  </span>
  {#if q.status === "recording" || q.status === "paused"}<span class="capture">{captureLabel}</span>{/if}
  <div class="spacer"></div>
  {#if canToggle}
    <button class="btn" class:rec={!recording} onclick={() => q.toggle()}>
      {#if recording}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="0.5" fill="currentColor" /><rect x="9.5" y="3" width="3" height="10" rx="0.5" fill="currentColor" /></svg>{m.watch_pause()}
      {:else}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="currentColor" /></svg>{m.watch_record()}
      {/if}
    </button>
  {/if}
  <button class="btn" onclick={() => q.clear()} disabled={!q.entries.length}>{m.watch_clear()}</button>
  <button class="btn" onclick={exportRecording} disabled={!q.entries.length}>{m.watch_export()}</button>
</div>

{#if q.status === "unavailable" && q.unavailable}
  {@const u = q.unavailable}
  {#if u.reason === "deployment"}
    <WatchNotice title={m.watch_q_deployment_title()} body={m.watch_q_deployment_body()} />
  {:else if u.reason === "mongos"}
    <WatchNotice icon="blocked" title={m.watch_q_mongos_title()} body={m.watch_q_mongos_body()} />
  {:else if u.reason === "readOnly"}
    <WatchNotice icon="lock" title={m.watch_q_readonly_title()} body={m.watch_q_readonly_body()} />
  {:else if u.reason === "denied"}
    <WatchNotice icon="lock" title={m.watch_q_denied_title()} body={m.watch_q_denied_body({ db: tab.db ?? "" })} detail={u.message}>
      <button class="btn" onclick={() => q.start()}>{m.watch_retry()}</button>
    </WatchNotice>
  {:else}
    <WatchNotice icon="blocked" title={m.watch_q_unsupported_title()} body={m.watch_q_unsupported_body()} detail={u.message} />
  {/if}
{:else if q.status === "idle"}
  <div class="start">
    <h3>{m.watch_q_start_title({ db: tab.db ?? "" })}</h3>
    <p>{m.watch_q_start_body()}</p>
    <fieldset>
      <legend class="sr">{m.watch_q_capture_label()}</legend>
      <label class="opt" class:on={q.capture === "all"}>
        <input type="radio" name="capture-{tab.id}" value="all" bind:group={q.capture} />
        <span><strong>{m.watch_q_capture_all()}</strong><small>{m.watch_q_capture_all_hint()}</small></span>
      </label>
      <label class="opt" class:on={q.capture === "slow"}>
        <input type="radio" name="capture-{tab.id}" value="slow" bind:group={q.capture} />
        <span>
          <strong>{m.watch_q_capture_slow_prefix()}
            <input class="ms" type="number" min="0" step="10" bind:value={q.slowms} onfocus={() => (q.capture = "slow")} aria-label="ms" /> ms</strong>
          <small>{m.watch_q_capture_slow_hint()}</small>
        </span>
      </label>
    </fieldset>
    {#if tab.coll}<p class="note">{m.watch_q_coll_note({ db: tab.db ?? "", coll: tab.coll })}</p>{/if}
    <button class="btn primary" onclick={() => q.start()}>{m.watch_q_start()}</button>
    <p class="note">{m.watch_q_restore_note()}</p>
  </div>
{:else}
  {#if q.error}
    <div class="error" role="alert">{q.error} <button class="link" onclick={() => q.start()}>{m.watch_retry()}</button></div>
  {/if}
  {#if q.dropped}
    <div class="info">{m.watch_dropped({ count: formatCount(q.dropped) })}</div>
  {/if}
  <div class="split">
    <div class="list">
      <div class="filters">
        <div class="chips" role="group" aria-label={m.watch_q_filter_kinds()}>
          {#each QUERY_KINDS as k (k)}
            <button
              class="chip kind-{k}"
              class:off={!q.kinds.has(k)}
              aria-pressed={q.kinds.has(k)}
              title={m.watch_op_chip_hint()}
              onclick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? q.soloKind(k) : q.toggleKind(k))}
              ondblclick={() => q.soloKind(k)}
            >{KIND_LABEL[k]()}<span class="n">{formatCount(q.counts[k])}</span></button>
          {/each}
          <button class="chip index" class:on={q.needsIndex} aria-pressed={q.needsIndex} title={m.watch_q_needs_index_hint()}
            onclick={() => (q.needsIndex = !q.needsIndex)}>{m.watch_q_needs_index()}<span class="n">{formatCount(needsIndexCount)}</span></button>
        </div>
        <input class="search" bind:value={q.text} placeholder={m.watch_q_search_placeholder()} aria-label={m.watch_q_search_placeholder()} spellcheck="false" />
      </div>
      <div class="row head cols" class:with-ns={showNs} aria-hidden="true">
        <span>{m.watch_col_time()}</span><span class="r">{m.watch_q_col_duration()}</span><span>{m.watch_q_col_command()}</span>
        {#if showNs}<span>{m.watch_col_ns()}</span>{/if}
        <span class="c-plan">{m.watch_q_col_plan()}</span><span class="r c-docs">{m.watch_q_col_docs()}</span><span>{m.watch_q_col_query()}</span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroller" bind:this={list.scroller} onscroll={list.onScroll} onkeydown={onListKey} tabindex="0" role="listbox" aria-label={m.watch_q_list_label()}>
        {#if !q.visible.length}
          <div class="empty">
            {#if q.entries.length}{m.watch_no_match()}
            {:else if recording}<span class="pulse" aria-hidden="true"></span>{m.watch_q_waiting()}
            {:else}{m.watch_paused_empty()}{/if}
          </div>
        {:else}
          <div style="height:{list.total}px; position:relative">
            {#each list.items as it (it.key)}
              {@const e = q.visible[it.index]}
              {#if e}
                {@const warn = indexHint(e)}
                <div
                  class="row cols"
                  class:with-ns={showNs}
                  class:selected={sel?.seq === e.seq}
                  style="position:absolute; top:0; left:0; right:0; height:{ROW_H}px; transform:translateY({it.start}px)"
                  role="option"
                  aria-selected={sel?.seq === e.seq}
                  tabindex="-1"
                  onclick={() => { q.select(e.seq); list.hold(); }}
                  onkeydown={() => {}}
                >
                  <span class="time">{formatClock(e.time)}</span>
                  <span class="r dur speed-{speedOf(e.millis)}">{formatMillis(e.millis)}</span>
                  <span><span class="badge kind-{e.kind}">{e.name}</span></span>
                  {#if showNs}<span class="mono" title={e.ns}>{e.coll}</span>{/if}
                  <span class="mono plan c-plan" class:warn={e.collscan} title={e.plan}>{planShort(e)}</span>
                  <span class="r mono c-docs" class:warn={!!warn}>{n(e.docsExamined)} → {n(e.kind === "write" ? e.affected : e.returned)}</span>
                  <span class="sum" title={querySummary(e)}>{querySummary(e)}</span>
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
        <div class="empty">{m.watch_q_select_hint()}</div>
      {:else}
        <div class="d-head">
          <span class="badge kind-{sel.kind}">{sel.name}</span>
          <span class="big speed-{speedOf(sel.millis)}">{formatMillis(sel.millis)}</span>
          <span class="d-time" title={new Date(sel.time).toLocaleString()}>{formatClock(sel.time)}</span>
          <div class="spacer"></div>
          {#if statement}
            <button class="link" onclick={() => copy(statement)}>{m.watch_q_copy()}</button>
            <button class="link" onclick={() => onopenquery(statement)}>{m.watch_q_open()}</button>
          {/if}
        </div>
        <div class="d-sub" title={sel.ns}>
          {sel.ns}{#if sel.appName}<span class="sep">·</span>{sel.appName}{/if}{#if sel.client}<span class="sep">·</span>{sel.client}{/if}
        </div>
        {#if hint}
          <div class="hint">
            {#if hint.kind === "collscan"}{m.watch_q_hint_collscan({ examined: n(sel.docsExamined) })}
            {:else}{m.watch_q_hint_ratio({ examined: formatCount(hint.examined), returned: formatCount(hint.returned) })}{/if}
          </div>
        {/if}
        <dl class="metrics">
          <div><dt>{m.watch_q_m_plan()}</dt><dd class:warn={sel.collscan}>{sel.plan || "—"}</dd></div>
          <div><dt>{m.watch_q_m_docs()}</dt><dd>{n(sel.docsExamined)}</dd></div>
          <div><dt>{m.watch_q_m_keys()}</dt><dd>{n(sel.keysExamined)}</dd></div>
          <div><dt>{sel.kind === "write" ? m.watch_q_m_affected() : m.watch_q_m_returned()}</dt><dd>{n(sel.kind === "write" ? sel.affected : sel.returned)}</dd></div>
        </dl>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={detailView === "command"} class:on={detailView === "command"} onclick={() => (detailView = "command")}>{m.watch_q_tab_command()}</button>
          <button role="tab" aria-selected={detailView === "json"} class:on={detailView === "json"} onclick={() => (detailView = "json")}>{m.watch_q_tab_json()}</button>
        </div>
        <div class="d-body">
          {#if detailView === "command"}
            <pre class="json">{pretty(sel.command)}</pre>
          {:else}
            <pre class="json">{pretty(sel.raw)}</pre>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .capture { color: var(--muted); font-size: 0.75rem; white-space: nowrap; }
  .cols { grid-template-columns: 6.5rem 4.5rem 6rem minmax(5.5rem, 0.9fr) 6.5rem minmax(8rem, 1.6fr); }
  .cols.with-ns { grid-template-columns: 6.5rem 4.5rem 6rem minmax(4.5rem, 0.6fr) minmax(4.5rem, 0.5fr) 6.5rem minmax(7rem, 1.4fr); }
  /* Narrow list: the plan moves to the detail pane only. */
  @container watch-list (max-width: 46rem) {
    .c-plan { display: none; }
    .cols { grid-template-columns: 6.5rem 4.5rem 6rem 6.5rem minmax(5rem, 1fr); }
    .cols.with-ns { grid-template-columns: 6.5rem 4.5rem 6rem minmax(4rem, 0.6fr) 6.5rem minmax(5rem, 1fr); }
  }
  @container watch-list (max-width: 34rem) {
    .c-docs { display: none; }
    .cols { grid-template-columns: 6.5rem 4.5rem 6rem minmax(5rem, 1fr); }
    .cols.with-ns { grid-template-columns: 6.5rem 4.5rem 6rem minmax(4rem, 0.6fr) minmax(5rem, 1fr); }
  }
  .r { text-align: right; }
  .dur { font-family: var(--mono); font-size: 0.75rem; font-variant-numeric: tabular-nums; font-weight: 600; }
  .speed-fast { color: var(--muted); }
  .speed-medium { color: var(--warn-fg); }
  .speed-slow { color: var(--danger); }
  .plan { color: var(--muted); }
  .warn { color: var(--warn-fg); }
  .kind-read { --op: var(--c-blue); }
  .kind-write { --op: var(--c-peach); }
  .kind-other { --op: var(--c-overlay1); }
  .chip.index { --op: var(--warn); }
  .chip.index:not(.on) { opacity: 0.7; }
  .chip.index.on { border-color: var(--warn); background: var(--warn-bg2); }
  .big { font-family: var(--mono); font-size: 1rem; font-weight: 600; }

  .start { max-width: 34rem; margin: 2.5rem auto; padding: 0 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .start h3 { margin: 0; font-size: 0.9375rem; font-weight: 600; }
  .start p { margin: 0; color: var(--muted); line-height: 1.55; }
  .start .note { font-size: 0.75rem; }
  .start .btn { align-self: flex-start; }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .opt {
    display: flex; gap: 0.625rem; align-items: flex-start; padding: 0.5rem 0.625rem; cursor: pointer;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel);
  }
  .opt.on { border-color: var(--accent); background: var(--selected); }
  .opt input[type="radio"] { margin: 0.1875rem 0 0; accent-color: var(--accent); }
  .opt span { display: flex; flex-direction: column; gap: 0.125rem; }
  .opt strong { font-weight: 500; color: var(--fg); }
  .opt small { color: var(--muted); font-size: 0.75rem; line-height: 1.45; }
  .ms {
    width: 4.5rem; height: 1.375rem; padding: 0 0.375rem; margin: 0 0.125rem; font-family: var(--mono); font-size: 0.75rem;
    border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg);
  }

  .hint {
    margin: 0 0.75rem 0.5rem; padding: 0.375rem 0.5rem; border-radius: var(--radius); font-size: 0.75rem; line-height: 1.45;
    color: var(--warn-fg); background: var(--warn-bg2);
  }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr)); gap: 0.5rem; margin: 0 0.75rem 0.5rem; }
  .metrics div { min-width: 0; padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); }
  .metrics dt { font-size: 0.6875rem; color: var(--muted); }
  .metrics dd { margin: 0.125rem 0 0; font-family: var(--mono); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
