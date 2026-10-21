<!-- src/lib/components/IndexPanel.svelte — a collection's indexes with size, usage and a safe hide-before-drop path. Rendering only; classification lives in domain/indexUsage. -->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createIndexView } from "../stores/indexView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { describeKeys, type IndexInfo } from "../domain/indexes";
  import { LOW_CONFIDENCE_DAYS, type IndexStatus } from "../domain/indexUsage";
  import { formatBytes, formatCount } from "../domain/stats";
  import { msgCount, msgKey } from "#lib/msgkey.js";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Modal from "./Modal.svelte";
  import IndexCreateForm from "./IndexCreateForm.svelte";
  import SearchIndexPanel from "./SearchIndexPanel.svelte";
  import { createSearchIndexView } from "../stores/searchIndexView.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createIndexView(sessionManager.active?.id ?? "", db, coll));
  const search = untrack(() => createSearchIndexView(sessionManager.active?.id ?? "", db, coll, sessionManager.active?.uri));
  const readOnly = $derived(sessionManager.active?.readOnly ?? false);
  let tab = $state<"regular" | "search">("regular");
  let creating = $state(false);

  function flags(idx: IndexInfo): string {
    const f: string[] = [];
    if (idx.unique) f.push("unique");
    if (idx.sparse) f.push("sparse");
    if (idx.partial) f.push("partial");
    if (idx.ttl !== null) f.push(`ttl=${idx.ttl}s`);
    return f.length ? f.join(", ") : "—";
  }

  const maxSize = $derived(Math.max(1, ...v.rows.map((r) => r.size ?? 0)));
  const attention = (s: IndexStatus) => s === "unused" || s === "rare";
  const protectedStatus = (s: IndexStatus) => s.startsWith("protected");
  const lowConfidence = $derived(v.dataDays !== null && v.dataDays < LOW_CONFIDENCE_DAYS);
  const sinceText = $derived(v.since ? new Date(v.since).toLocaleDateString() : null);

  onMount(() => {
    v.init();
    void search.detect();
  });

  // The tab only exists on Atlas; if detection settles the other way while it is open, fall back.
  $effect(() => {
    if (!search.isAtlas && tab === "search") tab = "regular";
  });
</script>

<div class="indexpanel">
  {#if search.isAtlas}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "regular"} class:on={tab === "regular"} onclick={() => (tab = "regular")}>{m.index_tab_regular()}</button>
      <button role="tab" aria-selected={tab === "search"} class:on={tab === "search"} onclick={() => (tab = "search")}>{m.index_tab_search()}</button>
    </div>
  {/if}
  {#if tab === "search" && search.isAtlas}
    <SearchIndexPanel view={search} {readOnly} />
  {:else}
  <div class="toolbar">
    <button onclick={() => (creating = true)}>{m.index_panel_create()}</button>
    <span class="summary" class:warn={v.summary.count > 0}>
      {v.summary.count > 0
        ? msgCount("index_summary", v.summary.count, { size: formatBytes(v.summary.bytes) })
        : v.usageError ? "" : m.index_summary_none()}
      {#if sinceText} · {m.index_summary_since({ date: sinceText })}{/if}
    </span>
  </div>
  {#if lowConfidence && v.dataDays !== null}<div class="note amber">{msgCount("index_low_confidence", v.dataDays)}</div>{/if}
  {#if v.traits.topology === "replica"}<div class="note">{m.index_replica_note({ host: v.traits.host ?? "—" })}</div>{/if}
  {#if v.traits.topology === "sharded"}<div class="note">{m.index_sharded_note()}</div>{/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if creating}
    <IndexCreateForm
      onsubmit={async (fields, unique, name, sparse, ttlSeconds, partialFilter, collation) => {
        await v.create(fields, unique, name, sparse, ttlSeconds, partialFilter, collation);
        creating = false;
      }}
      oncancel={() => (creating = false)}
    />
  {/if}
  <div class="scroller">
    <table>
      <thead>
        <tr>
          <th>{m.index_panel_col_name()}</th><th>{m.index_panel_col_keys()}</th><th>{m.index_panel_col_flags()}</th>
          <th class="num">{m.index_col_size()}</th><th class="num">{m.index_col_uses()}</th><th>{m.index_col_status()}</th><th class="act"></th>
        </tr>
      </thead>
      <tbody>
        {#each v.rows as row (row.info.name)}
          {@const idx = row.info}
          <tr class:attention={attention(row.status)} class:hidden-idx={idx.hidden}>
            <td>{idx.name}</td>
            <td class="keys">{describeKeys(idx.entries)}</td>
            <td>{flags(idx)}</td>
            <td class="num">
              {#if row.size !== null}
                <span class="size">{formatBytes(row.size)}</span>
                <span class="bar" aria-hidden="true"><span style="width:{Math.max(2, Math.round((row.size / maxSize) * 100))}%"></span></span>
              {:else}—{/if}
            </td>
            <td class="num" title={sinceText ? m.index_summary_since({ date: sinceText }) : undefined}>
              {#if v.usageError}<span class="muted">{m.index_uses_denied()}</span>{:else}{row.usage ? formatCount(row.usage.ops) : "—"}{/if}
            </td>
            <td>
              <span class="status {row.status}">{msgKey(`index_status_${row.status}`)}</span>
              {#if row.redundantWith}<div class="redundant">{m.index_redundant({ name: row.redundantWith })}</div>{/if}
            </td>
            <td class="act">
              {#if !readOnly && !protectedStatus(row.status)}
                {#if idx.hidden}
                  <button onclick={() => v.unhide(idx.name)}>{m.index_unhide()}</button>
                {:else if v.traits.canHide}
                  <button onclick={() => v.requestHide(idx.name)}>{m.index_hide()}</button>
                {:else}
                  <button disabled title={m.index_hide_old()}>{m.index_hide()}</button>
                {/if}
              {/if}
              <button class="danger" disabled={idx.isId} onclick={() => v.requestDrop(idx.name)}>{m.index_panel_drop()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if v.loading}<div class="status-line">{m.common_loading()}</div>{/if}
  </div>
  {/if}
</div>

<DestructiveDialog gate={v.destructive} />

{#if v.pendingHide}
  <ConfirmDialog
    title={m.index_hide_title({ name: v.pendingHide })}
    message={m.index_hide_body()}
    confirmLabel={m.index_hide()}
    onconfirm={() => void v.confirmHide()}
    oncancel={v.cancelHide}
  />
{/if}

{#if v.dropAdvice}
  {@const name = v.dropAdvice}
  <Modal title={m.index_drop_advice_title()} ondismiss={v.cancelDropAdvice} onenter={() => void v.hideInstead()}>
    {#snippet body()}<p class="advice">{m.index_drop_advice_body({ name })}</p>{/snippet}
    {#snippet footer()}
      <button onclick={v.cancelDropAdvice}>{m.common_cancel()}</button>
      <button class="danger-text" onclick={v.dropAnyway}>{m.index_drop_anyway()}</button>
      <button onclick={() => void v.hideInstead()}>{m.index_hide_instead()}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .indexpanel { display: flex; flex-direction: column; height: 100%; }
  .tabs { display: flex; gap: 0.25rem; padding: 0.25rem 0.5rem 0; border-bottom: 1px solid var(--bg); }
  .tabs button { height: 1.5rem; padding: 0 0.75rem; border: 1px solid transparent; border-bottom: 2px solid transparent; background: none; color: var(--muted); cursor: pointer; }
  .tabs button.on { color: var(--fg); border-bottom-color: var(--accent); }
  .toolbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); }
  .toolbar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar button:hover { background: var(--bg); }
  .summary { font-size: 0.75rem; color: var(--muted); }
  .summary.warn { color: var(--warn-fg); }
  .note { padding: 0.3125rem 0.625rem; font-size: 0.75rem; color: var(--muted); border-bottom: 1px solid var(--bg); }
  .note.amber { color: var(--warn-fg); background: color-mix(in srgb, var(--warn) 10%, transparent); }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--zebra); }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .keys { font-family: var(--mono); }
  .size { display: block; }
  .bar { display: block; height: 0.1875rem; margin-top: 0.1875rem; border-radius: 0.125rem; background: color-mix(in srgb, var(--accent) 15%, transparent); }
  .bar span { display: block; height: 100%; margin-left: auto; border-radius: 0.125rem; background: var(--accent); }
  tr.attention td { background: color-mix(in srgb, var(--warn) 6%, transparent); }
  tr.hidden-idx td { color: var(--muted); }
  .status { font-size: 0.75rem; }
  .status.unused, .status.rare { color: var(--warn-fg); font-weight: 600; }
  .status.hidden { color: var(--accent); }
  .status[class*="protected"] { color: var(--muted); }
  .redundant { margin-top: 0.125rem; font-size: 0.6875rem; color: var(--muted); }
  .muted { color: var(--muted); }
  td.act, th.act { white-space: nowrap; }
  td.act button { border: none; background: none; cursor: pointer; color: var(--fg); padding: 0 0.25rem; }
  td.act button:disabled { cursor: default; color: var(--gray-b8); }
  .danger { color: var(--error) !important; }
  .danger:disabled { color: var(--gray-b8) !important; }
  .danger-text { color: var(--error); }
  .advice { margin: 0; max-width: 28rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .status-line { padding: 0.5rem; color: var(--gray-77); font-size: var(--fs); }
</style>
