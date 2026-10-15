<script lang="ts">
  import { explainFlow, efficiency, explainAdvice, type ExplainSummary } from "../domain/explainPlan";
  import type { IndexSuggestion } from "../domain/indexAdvisor";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { copyToClipboard } from "../clipboard";
  import * as m from "#lib/paraglide/messages.js";

  let {
    summary, prevSummary, rawJson, loading, suggestion, coll, oncreateindex, onrefresh,
    pipeline = null, onmovematchfirst, prod = false,
  }: {
    summary: ExplainSummary | null;
    prevSummary: ExplainSummary | null;
    rawJson: string | null;
    loading: boolean;
    suggestion: IndexSuggestion | null;
    coll: string;
    oncreateindex: () => void;
    onrefresh: () => void;
    /** The builder's stages, when the explained statement is a pipeline (enables pipeline advice). */
    pipeline?: { name: string; body: unknown }[] | null;
    onmovematchfirst?: () => void;
    /** The session is PROD: the create-index confirmation says so. */
    prod?: boolean;
  } = $props();

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

  let confirmingCreate = $state(false);


  function improvementPct(before: ExplainSummary, after: ExplainSummary): number | null {
    const b = before.totalDocsExamined;
    const a = after.totalDocsExamined;
    if (b === null || a === null || b <= 0) return null;
    return Math.round(((b - a) / b) * 100);
  }

  async function copySnippet(text: string) {
    await copyToClipboard(text);
  }
</script>

{#snippet banner(s: ExplainSummary)}
  <div
    class="banner"
    class:warn={s.verdict === "collscan"}
    class:caution={s.verdict === "ixscan-inefficient"}
    class:ok={s.verdict === "ixscan"}
  >
    {#if s.verdict === "collscan"}
      <span>{m.explain_pane_verdict_collscan()}</span>
    {:else if s.verdict === "ixscan-inefficient"}
      <span>{m.explain_pane_verdict_ixscan_inefficient({ name: s.indexName ?? "" })}</span>
    {:else if s.verdict === "ixscan"}
      <span>{m.explain_pane_verdict_ixscan({ name: s.indexName ?? "" })}</span>
    {:else if s.verdict === "other"}
      <span>{m.explain_pane_verdict_other({ stage: s.stages[0]?.name ?? "" })}</span>
    {:else}
      <span>{m.explain_pane_verdict_unrecognized()}</span>
    {/if}
    {#if s.totalTimeMs !== null}
      <span class="time">{m.explain_pane_total_time({ ms: s.totalTimeMs })}</span>
    {/if}
  </div>
{/snippet}

<div class="explain-pane">
  {#if loading}
    <div class="status">{m.explain_pane_loading()}</div>
  {:else if summary}
    {@const flow = explainFlow(summary)}
    {@const eff = efficiency(summary)}
    {@const advice = explainAdvice(summary, pipeline)}
    {@render banner(summary)}

    {#if eff}<div class="eff">{m.explain_efficiency({ examined: fmt(eff.examined), returned: fmt(eff.returned), pct: String(eff.pct) })}</div>{/if}

    {#if flow.length > 0}
      <ol class="flow">
        {#each flow as row, i (i)}
          <li class:slow={row.slowest}>
            <div class="f-head">
              <span class="f-name">{row.name}</span>
              {#if row.slowest}<span class="f-slow">{m.explain_slowest()}</span>{/if}
              <span class="f-nums">
                {#if row.keys !== null}<span>{m.explain_flow_keys({ n: fmt(row.keys) })}</span>{/if}
                {#if row.docs !== null}<span>{m.explain_flow_docs({ n: fmt(row.docs) })}</span>{/if}
                {#if row.returned !== null}<span>{m.explain_flow_returned({ n: fmt(row.returned) })}</span>{/if}
                {#if row.ms !== null}<span class="ms">{m.explain_flow_ms({ n: String(row.ms) })}</span>{/if}
              </span>
            </div>
            <div class="f-track"><div class="f-bar" style={`width:${Math.max(row.widthPct, row.docs ? 0.6 : 0)}%`}></div></div>
          </li>
        {/each}
      </ol>
    {/if}

    {#each advice as a (a.key)}
      {#if a.key === "move_match_first"}
        <div class="advice">{m.explain_advice_move_match_first()}{#if onmovematchfirst}<button onclick={onmovematchfirst}>{m.explain_advice_move()}</button>{/if}</div>
      {:else if a.key === "in_memory_sort"}
        <div class="advice">{m.explain_advice_in_memory_sort()}</div>
      {:else if !suggestion}
        <div class="advice">{m.explain_advice_create_index()}</div>
      {/if}
    {/each}

    {#if (summary.verdict === "collscan" || summary.verdict === "ixscan-inefficient") && suggestion}
      <div class="suggestion">
        <div class="suggestion-title">{m.explain_pane_suggested_index_title()}</div>
        <code>{suggestion.snippet}</code>
        <div class="suggestion-actions">
          <button onclick={() => copySnippet(suggestion.snippet)}>{m.explain_pane_copy_snippet()}</button>
          <button onclick={() => (confirmingCreate = true)}>{m.explain_pane_create_index()}</button>
        </div>
      </div>
    {/if}

    {#if prevSummary}
      <div class="compare">
        <div class="compare-col">
          <div class="compare-label">{m.explain_pane_before()}</div>
          {@render banner(prevSummary)}
        </div>
        <div class="compare-col">
          <div class="compare-label">{m.explain_pane_after()}</div>
          {@render banner(summary)}
        </div>
        {#if improvementPct(prevSummary, summary) !== null}
          <div class="improvement">
            {m.explain_pane_improvement({ percent: improvementPct(prevSummary, summary) ?? 0 })}
          </div>
        {/if}
      </div>
    {/if}

    <div class="refresh-row">
      <button onclick={onrefresh}>{m.explain_pane_refresh()}</button>
    </div>

    {#if rawJson}
      <details class="raw">
        <summary>{m.explain_pane_raw_json()}</summary>
        <pre>{rawJson}</pre>
      </details>
    {/if}
  {/if}
</div>

{#if confirmingCreate && suggestion}
  <ConfirmDialog
    title={m.explain_confirm_create_index_title()}
    message={prod ? `${m.explain_confirm_create_index_message({ snippet: suggestion.snippet, coll })} ${m.explain_prod_note()}` : m.explain_confirm_create_index_message({ snippet: suggestion.snippet, coll })}
    onconfirm={() => { confirmingCreate = false; oncreateindex(); }}
    oncancel={() => (confirmingCreate = false)}
  />
{/if}

<style>
  .explain-pane { flex: 1; min-height: 0; overflow: auto; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .status { color: var(--muted); font-size: var(--fs); }
  .banner { display: flex; align-items: center; justify-content: space-between; padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: 0.8125rem; background: var(--panel); }
  .banner.warn { background: var(--warn-bg2); color: var(--warn-fg); }
  .banner.caution { background: var(--warn-bg); color: var(--warn-fg); }
  .banner.ok { background: var(--bg); color: var(--fg); }
  .banner .time { font-variant-numeric: tabular-nums; color: var(--muted); }
  .eff { font-size: 0.8125rem; color: var(--fg); }
  .flow { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }
  .flow li { position: relative; padding-left: 0.875rem; }
  .flow li::before { content: ""; position: absolute; left: 0.25rem; top: 0.375rem; bottom: -0.5rem; width: 1px; background: var(--border); }
  .flow li:last-child::before { display: none; }
  .f-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
  .f-name { font-family: var(--mono); font-size: 0.75rem; font-weight: 600; }
  .f-slow { font-size: 0.625rem; padding: 0 0.3125rem; border-radius: var(--radius-sm); background: var(--warn-bg); color: var(--warn-fg); }
  .f-nums { display: flex; gap: 0.625rem; font-size: 0.6875rem; color: var(--muted); font-variant-numeric: tabular-nums; margin-left: auto; }
  .flow li.slow .ms { color: var(--warn-fg); font-weight: 600; }
  .f-track { height: 0.375rem; margin-top: 0.1875rem; border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
  .f-bar { height: 100%; background: var(--accent); border-radius: var(--radius-sm); }
  .advice { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 0.625rem; border-radius: var(--radius); background: var(--warn-bg2); color: var(--warn-fg); font-size: 0.75rem; }
  .advice button { height: 1.5rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer; }
  .suggestion { border: 1px solid var(--gray-cf); border-radius: var(--radius); padding: 0.5rem 0.625rem; display: flex; flex-direction: column; gap: 0.375rem; }
  .suggestion-title { font-weight: 600; font-size: var(--fs); }
  .suggestion code { font-family: var(--mono); font-size: var(--fs); background: var(--bg); padding: 0.25rem 0.375rem; border-radius: var(--radius); }
  .suggestion-actions { display: flex; gap: 0.5rem; }
  .compare { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
  .compare-col { flex: 1; min-width: 12rem; }
  .compare-label { font-size: 0.6875rem; color: var(--muted); margin-bottom: 0.1875rem; }
  .improvement { font-size: var(--fs); color: var(--ok-fg); font-weight: 600; }
  .refresh-row { display: flex; justify-content: flex-end; }
  .raw pre { margin: 0; font-family: var(--mono); font-size: var(--fs); white-space: pre-wrap; word-break: break-word; }
</style>
