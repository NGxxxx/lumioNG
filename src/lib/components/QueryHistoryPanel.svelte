<!-- src/lib/components/QueryHistoryPanel.svelte — the query tab's run history: search, This tab / All, errors only, grouped by day; Load into this tab or open in a new one. Rendering only; rules live in domain/queryHistory. -->
<script lang="ts">
  import { groupByDay, searchHistory, type HistoryEntry } from "../domain/queryHistory";
  import { msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { entries, tabId, onload, onopen, onclear, onclose }: {
    entries: HistoryEntry[];
    tabId: number;
    onload: (e: HistoryEntry) => void;
    onopen: (e: HistoryEntry) => void;
    onclear: () => void;
    onclose: () => void;
  } = $props();

  let q = $state("");
  let scope = $state<"tab" | "all">("all");
  let errorsOnly = $state(false);
  let expanded = $state<string | null>(null);

  const groups = $derived(
    groupByDay(searchHistory(entries, q, { tabId: scope === "tab" ? tabId : undefined, errorsOnly }), new Date()),
  );
  const GROUP_LABEL = { today: m.history_today, yesterday: m.history_yesterday, week: m.history_week, older: m.history_older };

  const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? s;
  function outcomeText(e: HistoryEntry): string {
    if (e.outcome.kind === "error") return e.outcome.message ?? "error";
    if (e.outcome.kind === "modified") return m.history_modified({ count: String(e.outcome.n ?? "?") });
    return msgCount("history_docs", e.outcome.n ?? 0);
  }
</script>

<aside class="history" aria-label={m.history_title()}>
  <header>
    <span class="title">{m.history_title()}</span>
    <button class="x" aria-label={m.peek_close()} onclick={onclose}>×</button>
  </header>
  <div class="filters">
    <input class="search" placeholder={m.history_search()} aria-label={m.history_search()} bind:value={q} />
    <div class="seg" role="radiogroup" aria-label={m.history_title()}>
      <button role="radio" aria-checked={scope === "tab"} class:on={scope === "tab"} onclick={() => (scope = "tab")}>{m.history_this_tab()}</button>
      <button role="radio" aria-checked={scope === "all"} class:on={scope === "all"} onclick={() => (scope = "all")}>{m.history_all()}</button>
    </div>
    <label class="chk"><input type="checkbox" bind:checked={errorsOnly} /> {m.history_errors()}</label>
  </div>
  <div class="list">
    {#if groups.length === 0}<div class="empty">{m.history_empty()}</div>{/if}
    {#each groups as g (g.key)}
      <div class="group">{GROUP_LABEL[g.key]()}</div>
      {#each g.entries as e (e.id)}
        <div class="entry" class:err={e.outcome.kind === "error"}>
          <button class="line" aria-expanded={expanded === e.id} onclick={() => (expanded = expanded === e.id ? null : e.id)}>
            <code>{firstLine(e.script)}</code>
            <span class="meta">
              <span class="db">{e.db}</span>
              {#if e.ms !== null}<span>{e.ms} ms</span>{/if}
              <span class:bad={e.outcome.kind === "error"}>{outcomeText(e)}</span>
              {#if e.runs > 1}<span>{m.history_runs({ count: String(e.runs) })}</span>{/if}
            </span>
          </button>
          {#if expanded === e.id}
            <pre>{e.script}</pre>
            <div class="acts">
              <button onclick={() => onload(e)}>{m.history_load()}</button>
              <button onclick={() => onopen(e)}>{m.history_open()}</button>
            </div>
          {/if}
        </div>
      {/each}
    {/each}
  </div>
  {#if entries.length}<button class="clear" onclick={onclear}>{m.history_clear()}</button>{/if}
</aside>

<style>
  .history { width: 22rem; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--panel); min-height: 0; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.625rem; border-bottom: 1px solid var(--border); }
  .title { font-weight: 600; font-size: var(--fs); }
  .x { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 1rem; }
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; padding: 0.5rem 0.625rem; }
  .search { flex: 1 1 100%; height: 1.75rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
  .seg { display: inline-flex; border: 1px solid var(--c-surface1); border-radius: var(--radius); padding: 0.0625rem; }
  .seg button { border: none; background: none; padding: 0.125rem 0.5rem; border-radius: var(--radius-sm); color: var(--muted); font-size: 0.75rem; cursor: pointer; }
  .seg button.on { background: var(--menu-hover); color: var(--fg); }
  .chk { display: flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; color: var(--muted); }
  .list { flex: 1; min-height: 0; overflow: auto; padding: 0 0.375rem 0.5rem; }
  .empty { padding: 1rem; text-align: center; color: var(--muted); font-size: 0.75rem; }
  .group { padding: 0.5rem 0.25rem 0.25rem; font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .entry { border-radius: var(--radius); }
  .entry.err code { color: var(--error); }
  .line { width: 100%; display: flex; flex-direction: column; gap: 0.1875rem; padding: 0.375rem; border: none; border-radius: var(--radius); background: none; color: var(--fg); text-align: left; cursor: pointer; }
  .line:hover { background: var(--hover); }
  code { font-family: var(--mono); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; font-size: 0.6875rem; color: var(--muted); }
  .meta > span { white-space: nowrap; }
  .meta > .bad { white-space: normal; flex-basis: 100%; }
  .db { padding: 0 0.25rem; border-radius: var(--radius-sm); background: var(--menu-hover); }
  .bad { color: var(--error); }
  pre { margin: 0 0.375rem 0.375rem; padding: 0.375rem; max-height: 12rem; overflow: auto; border-radius: var(--radius); background: var(--bg); font-size: 0.6875rem; white-space: pre-wrap; }
  .acts { display: flex; gap: 0.375rem; padding: 0 0.375rem 0.5rem; }
  .acts button, .clear { height: 1.625rem; padding: 0 0.625rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer; }
  .clear { margin: 0.375rem 0.625rem 0.625rem; }
</style>
