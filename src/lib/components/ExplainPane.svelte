<script lang="ts">
  import type { ExplainSummary } from "../domain/explainPlan";
  import type { IndexSuggestion } from "../domain/indexAdvisor";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import * as m from "$lib/paraglide/messages";

  let {
    summary, prevSummary, rawJson, loading, error, suggestion, coll, oncreateindex, onrefresh,
  }: {
    summary: ExplainSummary | null;
    prevSummary: ExplainSummary | null;
    rawJson: string | null;
    loading: boolean;
    error: string | null;
    suggestion: IndexSuggestion | null;
    coll: string;
    oncreateindex: () => void;
    onrefresh: () => void;
  } = $props();

  let confirmingCreate = $state(false);

  function maxDocsExamined(stages: ExplainSummary["stages"]): number {
    return stages.reduce((max, s) => Math.max(max, s.docsExamined ?? 0), 0);
  }

  function barPct(stage: ExplainSummary["stages"][number], max: number): number {
    if (max <= 0 || stage.docsExamined === null) return 0;
    return Math.round((stage.docsExamined / max) * 100);
  }

  function improvementPct(before: ExplainSummary, after: ExplainSummary): number | null {
    const b = before.totalDocsExamined;
    const a = after.totalDocsExamined;
    if (b === null || a === null || b <= 0) return null;
    return Math.round(((b - a) / b) * 100);
  }

  async function copySnippet(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard unavailable — no-op, matches ConsolePane's copy-line behavior
    }
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
  {:else if error}
    <div class="error">{error}</div>
  {:else if summary}
    {@const max = maxDocsExamined(summary.stages)}
    {@render banner(summary)}

    {#if summary.stages.length > 0}
      <table class="stages">
        <thead>
          <tr>
            <th>{m.explain_pane_stage_header_name()}</th>
            <th>{m.explain_pane_stage_header_returned()}</th>
            <th>{m.explain_pane_stage_header_examined()}</th>
            <th>{m.explain_pane_stage_header_keys()}</th>
            <th>{m.explain_pane_stage_header_time()}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each summary.stages as stage (stage.name)}
            <tr>
              <td>{stage.name}</td>
              <td>{stage.nReturned ?? "—"}</td>
              <td>{stage.docsExamined ?? "—"}</td>
              <td>{stage.keysExamined ?? "—"}</td>
              <td>{stage.executionTimeMs ?? "—"}</td>
              <td class="bar-cell"><div class="bar" style={`width:${barPct(stage, max)}%`}></div></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

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
    message={m.explain_confirm_create_index_message({ snippet: suggestion.snippet, coll })}
    onconfirm={() => { confirmingCreate = false; oncreateindex(); }}
    oncancel={() => (confirmingCreate = false)}
  />
{/if}

<style>
  .explain-pane { flex: 1; min-height: 0; overflow: auto; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .status { color: var(--muted); font-size: var(--fs); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); }
  .banner { display: flex; align-items: center; justify-content: space-between; padding: 0.375rem 0.625rem; border-radius: 0.1875rem; font-size: 0.8125rem; background: var(--panel); }
  .banner.warn { background: var(--warn-bg2); color: var(--warn-fg); }
  .banner.caution { background: var(--warn-bg); color: var(--warn-fg); }
  .banner.ok { background: var(--bg); color: var(--fg); }
  .banner .time { font-variant-numeric: tabular-nums; color: var(--muted); }
  table.stages { border-collapse: collapse; font-size: var(--fs); width: 100%; }
  table.stages th, table.stages td { padding: 0.1875rem 0.5rem; text-align: left; }
  table.stages th { color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
  .bar-cell { width: 6rem; }
  .bar { height: 0.5rem; background: var(--accent); border-radius: 0.125rem; }
  .suggestion { border: 1px solid var(--gray-cf); border-radius: 0.1875rem; padding: 0.5rem 0.625rem; display: flex; flex-direction: column; gap: 0.375rem; }
  .suggestion-title { font-weight: 600; font-size: var(--fs); }
  .suggestion code { font-family: ui-monospace, monospace; font-size: var(--fs); background: var(--bg); padding: 0.25rem 0.375rem; border-radius: 0.1875rem; }
  .suggestion-actions { display: flex; gap: 0.5rem; }
  .compare { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
  .compare-col { flex: 1; min-width: 12rem; }
  .compare-label { font-size: 0.6875rem; color: var(--muted); margin-bottom: 0.1875rem; }
  .improvement { font-size: var(--fs); color: var(--run); font-weight: 600; }
  .refresh-row { display: flex; justify-content: flex-end; }
  .raw pre { margin: 0; font-family: ui-monospace, monospace; font-size: var(--fs); white-space: pre-wrap; word-break: break-word; }
</style>
