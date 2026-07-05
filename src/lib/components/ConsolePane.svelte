<script lang="ts">
  import type { ConsoleEntry } from "../api/script";
  import * as m from "$lib/paraglide/messages";

  let { entries, elapsedMs = null, onClear }:
    { entries: ConsoleEntry[]; elapsedMs?: number | null; onClear?: () => void } = $props();

  // Entries longer than this are collapsed with a Show more / Show less toggle.
  const LARGE = 1500;
  let expanded = $state<Set<number>>(new Set());

  function toggle(i: number) {
    const next = new Set(expanded);
    if (next.has(i)) next.delete(i); else next.add(i);
    expanded = next;
  }

  async function copyLine(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
  }

  function shown(entry: ConsoleEntry, i: number): string {
    if (entry.text.length <= LARGE || expanded.has(i)) return entry.text;
    return entry.text.slice(0, LARGE) + "…";
  }
</script>

<div class="pane">
  <div class="head">
    {#if elapsedMs !== null}
      <span class="elapsed">{m.query_tab_console_elapsed({ ms: elapsedMs })}</span>
    {/if}
    <button class="head-btn" disabled={entries.length === 0} onclick={() => onClear?.()}>
      {m.query_tab_console_clear()}
    </button>
  </div>

  {#if entries.length === 0}
    <div class="idle">{m.query_tab_status_idle()}</div>
  {:else}
    <div class="console">
      {#each entries as entry, i (i)}
        <div class="entry" class:error={entry.level === "error"}>
          <div class="text">{shown(entry, i)}</div>
          <div class="row-actions">
            {#if entry.text.length > LARGE}
              <button class="line-btn" onclick={() => toggle(i)}>
                {expanded.has(i) ? m.query_tab_console_show_less() : m.query_tab_console_show_more()}
              </button>
            {/if}
            <button class="line-btn" title={m.query_tab_console_copy()}
              aria-label={m.query_tab_console_copy()} onclick={() => copyLine(entry.text)}>⧉</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .head { display: flex; align-items: center; gap: 0.5rem; flex: none; height: 1.5rem; padding: 0 0.5rem; border-bottom: 1px solid var(--border); background: var(--bg); }
  .elapsed { font-size: 0.6875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .head-btn { margin-left: auto; border: none; background: none; cursor: pointer; font-size: 0.6875rem; color: var(--muted); padding: 0.125rem 0.375rem; border-radius: 0.125rem; }
  .head-btn:hover:not(:disabled) { color: var(--fg); background: var(--hover); }
  .head-btn:disabled { opacity: 0.4; cursor: default; }
  .idle { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; }
  .console { flex: 1; min-height: 0; overflow: auto; padding: 0.25rem 0; }
  .entry { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.125rem 0.625rem; }
  .entry:hover { background: var(--hover); }
  .entry .text {
    flex: 1; min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--fg);
  }
  .entry.error { background: var(--error-bg); }
  .entry.error .text { color: var(--error); }
  .row-actions { display: flex; gap: 0.1875rem; flex: none; opacity: 0; }
  .entry:hover .row-actions { opacity: 1; }
  .line-btn { border: none; background: none; cursor: pointer; font-size: 0.6875rem; color: var(--muted); padding: 0 0.25rem; border-radius: 0.125rem; }
  .line-btn:hover { color: var(--fg); background: var(--menu-hover); }
</style>
