<!-- Compare tab: two collections (any sessions / clusters) side by side — summary, differences with a
     field diff, then a sync that must be dry-run first. The written side, its environment and the
     direction arrow stay on screen; PROD goes through the destructive gate. State lives in compareView. -->
<script lang="ts">
  import { untrack, onDestroy } from "svelte";
  import type { CompareTab } from "../stores/navigation.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createCompareView, type ListKind } from "../stores/compareView.svelte";
  import { formatChange } from "../domain/docDiff";
  import { formatKey, plannedTotal, type NsRef } from "../domain/compare";
  import EnvBadge from "./EnvBadge.svelte";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tab }: { tab: CompareTab } = $props();

  function lookup(id: string) {
    const s = sessionManager.sessions.find((x) => x.id === id);
    return s ? { label: s.label, environment: s.environment, readOnly: s.readOnly } : undefined;
  }
  const cv = untrack(() => createCompareView({ tabId: tab.id, src: { sessionId: tab.sessionId, db: tab.db, coll: tab.coll }, sessionInfo: lookup }));
  onDestroy(() => cv.dispose());

  const sessions = $derived(sessionManager.sessions);
  const listId = `compare-${untrack(() => tab.id)}`;
  const dbsOf = (id: string) => sessions.find((s) => s.id === id)?.tree?.databases ?? [];
  const collsOf = (id: string, db: string) => dbsOf(id).find((d) => d.name === db)?.collections ?? [];
  const envOf = (id: string) => lookup(id)?.environment ?? "";
  const busy = $derived(cv.comparing || cv.syncing !== null);

  const KINDS = $derived<{ key: ListKind; label: string; count: number }[]>([
    { key: "onlySrc", label: m.compare_only_src(), count: cv.summary?.onlySrc ?? 0 },
    { key: "onlyDst", label: m.compare_only_dst(), count: cv.summary?.onlyDst ?? 0 },
    { key: "different", label: m.compare_different(), count: cv.summary?.different ?? 0 },
  ]);
  const identical = $derived(!!cv.summary && cv.summary.onlySrc + cv.summary.onlyDst + cv.summary.different === 0);
  const pretty = (v: unknown) => JSON.stringify(v, null, 2);
</script>

{#snippet sidePicker(side: NsRef, title: string, which: "src" | "dst")}
  <fieldset class="side" disabled={busy}>
    <legend>{title} <EnvBadge env={envOf(side.sessionId)} /></legend>
    <label>
      <span>{m.compare_session()}</span>
      <select bind:value={side.sessionId} aria-label={`${title} ${m.compare_session()}`}>
        {#if !lookup(side.sessionId)}<option value={side.sessionId}>{side.sessionId} ({m.compare_disconnected()})</option>{/if}
        {#each sessions as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
      </select>
    </label>
    <label>
      <span>{m.compare_db()}</span>
      <input bind:value={side.db} list={`${listId}-${which}-db`} aria-label={`${title} ${m.compare_db()}`} spellcheck="false" />
      <datalist id={`${listId}-${which}-db`}>{#each dbsOf(side.sessionId) as d (d.name)}<option value={d.name}></option>{/each}</datalist>
    </label>
    <label>
      <span>{m.compare_coll()}</span>
      <input bind:value={side.coll} list={`${listId}-${which}-coll`} aria-label={`${title} ${m.compare_coll()}`} spellcheck="false" />
      <datalist id={`${listId}-${which}-coll`}>{#each collsOf(side.sessionId, side.db) as c (c)}<option value={c}></option>{/each}</datalist>
    </label>
  </fieldset>
{/snippet}

{#snippet endpoint(n: NsRef)}
  <span class="end"><EnvBadge env={envOf(n.sessionId)} size="md" /><b>{cv.sessionLabel(n.sessionId)}</b> <span class="mono">{n.db}.{n.coll}</span></span>
{/snippet}

<div class="compare">
  <div class="bar">
    <strong>{m.compare_heading()}</strong>
    <span class="spacer"></span>
    {#if cv.comparing}
      <span class="muted" role="status">{m.compare_progress({ read: String(cv.progress?.read ?? 0) })}</span>
      <button class="btn" onclick={() => cv.cancel()}>{m.compare_cancel()}</button>
    {:else}
      <button class="btn primary" onclick={() => cv.compare()} disabled={busy}>{m.compare_run()}</button>
    {/if}
  </div>

  <div class="setup">
    {@render sidePicker(cv.src, m.compare_source(), "src")}
    {@render sidePicker(cv.dst, m.compare_destination(), "dst")}
    <fieldset class="opts" disabled={busy}>
      <label><span>{m.compare_key()}</span><input bind:value={cv.key} placeholder="_id" spellcheck="false" /></label>
      <label class="grow"><span>{m.compare_filter()}</span><input class="mono" bind:value={cv.filterText} placeholder={"{}"} spellcheck="false" /></label>
      <label class="grow"><span>{m.compare_ignore()}</span><input bind:value={cv.ignoreText} placeholder={m.compare_ignore_placeholder()} spellcheck="false" /></label>
      <p class="hint">{m.compare_ignore_hint()}</p>
    </fieldset>
  </div>

  {#if cv.error}<div class="error" role="alert">{cv.error}</div>{/if}

  {#if cv.summary}
    <div class="kinds" role="tablist" aria-label={m.compare_list_label()}>
      {#each KINDS as k (k.key)}
        <button role="tab" aria-selected={cv.kind === k.key} class:on={cv.kind === k.key} onclick={() => cv.showKind(k.key)}>
          {k.label} <span class="n">{k.count.toLocaleString("en-US")}</span>
        </button>
      {/each}
      <span class="same">{m.compare_same()} <span class="n">{cv.summary.same.toLocaleString("en-US")}</span></span>
    </div>
    {#if cv.summary.truncated}<div class="info">{m.compare_truncated()}</div>{/if}

    <div class="split">
      <div class="list">
        {#if identical}
          <div class="empty">{m.compare_identical()}</div>
        {:else if cv.rows.length === 0}
          <div class="empty">{m.compare_empty()}</div>
        {:else}
          <div class="row head"><span>{m.compare_col_key()}</span></div>
          <div class="scroller">
            {#each cv.rows as r, i (i)}
              <button class="row" class:selected={i === cv.selected} onclick={() => cv.select(i)}>
                <span class="mono">{formatKey(r.key)}</span>
              </button>
            {/each}
          </div>
          <div class="pager">
            <button class="btn" onclick={() => cv.goPage(-1)} disabled={cv.page === 0 || cv.loadingPage} aria-label={m.compare_prev()}>‹</button>
            <span class="muted">{m.compare_page({ page: String(cv.page + 1), pages: String(cv.pageCount) })}</span>
            <button class="btn" onclick={() => cv.goPage(1)} disabled={cv.page + 1 >= cv.pageCount || cv.loadingPage} aria-label={m.compare_next()}>›</button>
          </div>
        {/if}
      </div>
      <div class="detail">
        {#if cv.selectedRow}
          {@const r = cv.selectedRow}
          {#if r.src && r.dst}
            <div class="caption">{m.compare_changes()}</div>
            {#if cv.changes.length === 0}
              <div class="muted">{m.compare_no_field_changes()}</div>
            {:else}
              <ul class="changes">
                {#each cv.changes as c, i (i)}<li class="mono {c.kind}">{formatChange(c)}</li>{/each}
              </ul>
            {/if}
          {:else}
            {@const d = r.src ?? r.dst}
            {#if d}<pre class="json">{pretty(d)}</pre>{:else}<div class="muted">{m.compare_gone()}</div>{/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <section class="sync" aria-label={m.compare_sync_heading()}>
    <div class="direction" class:prod={cv.targetEnv === "prod"}>
      {@render endpoint(cv.from)}
      <span class="arrow" aria-hidden="true">→</span>
      <span class="writes">{m.compare_writes_into()}</span>
      {@render endpoint(cv.target)}
      <button class="btn" onclick={() => cv.swapDirection()} disabled={busy}>⇄ {m.compare_reverse()}</button>
    </div>
    <div class="ops">
      <label><input type="checkbox" bind:checked={cv.insertMissing} disabled={busy} /> {m.compare_insert_missing()}</label>
      <label><input type="checkbox" bind:checked={cv.replaceDifferent} disabled={busy} /> {m.compare_replace_different()}</label>
      <label><input type="checkbox" bind:checked={cv.deleteExtra} disabled={busy} /> {m.compare_delete_extra()}</label>
    </div>
    {#if cv.targetReadOnly}
      <div class="error">{m.compare_read_only()}</div>
    {:else if cv.targetEnv === "prod"}
      <div class="caption warn">{m.compare_prod_warning()}</div>
    {/if}
    <div class="actions">
      <button class="btn" onclick={() => cv.dryRun()} disabled={busy || cv.targetReadOnly}>{m.compare_dry_run()}</button>
      <button class="btn primary" class:danger={cv.targetEnv === "prod"} onclick={() => cv.requestApply()} disabled={!cv.canApply}>{m.compare_apply()}</button>
      {#if cv.syncing}
        <span class="muted" role="status">{m.compare_progress({ read: String(cv.syncProgress?.read ?? 0) })} · {m.compare_syncing({ written: String(cv.syncProgress?.written ?? 0) })}</span>
        <button class="btn" onclick={() => cv.cancel()}>{m.compare_cancel()}</button>
      {:else if cv.dryRunReport}
        {@const p = cv.dryRunReport.planned}
        <span>{m.compare_dry_result({ insert: String(p.insert), replace: String(p.replace), delete: String(p.delete) })}</span>
        {#if cv.dryRunReport.typeConflicts > 0}<span class="warn-text">{m.compare_type_conflicts({ count: String(cv.dryRunReport.typeConflicts) })}</span>{/if}
        {#if plannedTotal(cv.dryRunReport) === 0}<span class="muted">{m.compare_nothing_to_sync()}</span>{/if}
      {:else if !cv.targetReadOnly}
        <span class="muted">{m.compare_apply_hint()}</span>
      {/if}
    </div>
    {#if cv.syncError}<div class="error" role="alert">{cv.syncError}</div>{/if}
    {#if cv.syncReport}
      {@const a = cv.syncReport.applied}
      <div class="caption">
        {cv.syncReport.cancelled ? m.compare_sync_cancelled() : ""}
        {m.compare_sync_done({ insert: String(a.insert), replace: String(a.replace), delete: String(a.delete), failed: String(cv.syncReport.failed) })}
        {#if cv.syncReport.skipped > 0}{m.compare_sync_skipped({ count: String(cv.syncReport.skipped) })}{/if}
        {#if cv.syncReport.typeConflicts > 0}{m.compare_type_conflicts({ count: String(cv.syncReport.typeConflicts) })}{/if}
      </div>
      {#if cv.syncReport.errors.length}
        <ul class="changes">{#each cv.syncReport.errors as e, i (i)}<li class="mono">{e}</li>{/each}</ul>
      {/if}
    {/if}
  </section>
</div>

<DestructiveDialog gate={cv.gate} />

<style>
  .compare { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-size: var(--fs); }
  .bar { display: flex; align-items: center; gap: 0.625rem; height: 2.375rem; flex: none; padding: 0 0.625rem; background: var(--panel); border-bottom: 1px solid var(--border); }
  .spacer { flex: 1; }
  .muted { color: var(--muted); font-size: 0.75rem; }
  .mono { font-family: var(--mono); font-size: 0.75rem; }
  .btn {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.625rem; white-space: nowrap;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: var(--fs); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--hover); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn.primary { background: var(--run); border-color: transparent; color: var(--on-accent); font-weight: 600; }
  .btn.primary:hover:not(:disabled) { background: var(--run-hover); }
  .btn.primary.danger { background: var(--danger); }

  .setup { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0.5rem 1rem; padding: 0.625rem; flex: none; border-bottom: 1px solid var(--border); }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); margin: 0; padding: 0.375rem 0.625rem 0.5rem; display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
  fieldset.opts { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; border: 0; padding: 0; }
  legend { display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 600; padding: 0 0.25rem; }
  label { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  label > span { flex: none; width: 6.5rem; color: var(--muted); font-size: 0.75rem; }
  .opts label > span { width: auto; }
  .opts label.grow { flex: 1 1 14rem; }
  input:not([type="checkbox"]), select {
    flex: 1; min-width: 0; height: 1.625rem; padding: 0 0.5rem; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--bg); color: var(--fg); font-size: var(--fs);
  }
  input:focus, select:focus { outline: none; border-color: var(--accent); }

  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; flex: none; }
  .info { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.25rem 0.625rem; flex: none; font-size: 0.75rem; }

  .kinds { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; padding: 0.375rem 0.625rem; flex: none; border-bottom: 1px solid var(--border); }
  .kinds button, .same {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.5rem; padding: 0 0.625rem;
    border: 1px solid var(--border); border-radius: 999px; background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer;
  }
  .kinds button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .same { cursor: default; color: var(--muted); }
  .n { font-variant-numeric: tabular-nums; color: var(--muted); }

  .split { display: grid; grid-template-columns: minmax(12rem, 32%) minmax(0, 1fr); min-height: 14rem; flex: 1 0 14rem; }
  .list { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--border); }
  .scroller { flex: 1; min-height: 0; overflow: auto; }
  .row {
    display: flex; align-items: center; width: 100%; height: 1.625rem; padding: 0 0.625rem; box-sizing: border-box; border: 0;
    border-bottom: 1px solid var(--row-divider); background: none; color: var(--fg); text-align: left; cursor: pointer;
  }
  .row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row:hover:not(.head) { background: var(--row-hover); }
  .row.selected { background: var(--row-selected); box-shadow: inset 2px 0 var(--accent); }
  .row.head { cursor: default; flex: none; color: var(--th-fg); font-size: 0.75rem; font-weight: 600; background: var(--bg); border-bottom: 1px solid var(--border); }
  .pager { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.375rem; border-top: 1px solid var(--border); flex: none; }
  .empty { padding: 2rem 1rem; color: var(--muted); text-align: center; }
  .detail { min-width: 0; overflow: auto; padding: 0.625rem 0.75rem; background: var(--panel); }
  .caption { color: var(--muted); font-size: 0.75rem; margin-bottom: 0.5rem; line-height: 1.45; }
  .caption.warn { color: var(--warn-fg); background: var(--warn-bg2); padding: 0.375rem 0.5rem; border-radius: var(--radius); }
  .changes { margin: 0; padding-left: 1rem; display: flex; flex-direction: column; gap: 0.25rem; word-break: break-word; }
  .changes .added { color: var(--ok-fg); }
  .changes .removed { color: var(--danger); }
  .json {
    margin: 0; font-family: var(--mono); font-size: 0.75rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem 0.625rem;
  }

  .sync { flex: none; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.625rem; border-top: 1px solid var(--border); background: var(--panel); }
  .direction { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.5rem 0.625rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
  .direction.prod { border-color: var(--danger); }
  .end { display: inline-flex; align-items: center; gap: 0.375rem; min-width: 0; }
  .arrow { font-size: 1.25rem; font-weight: 700; color: var(--accent); }
  .writes { color: var(--muted); font-size: 0.75rem; }
  .ops { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .hint { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 0.6875rem; }
  .warn-text { color: var(--warn-fg); }
</style>
