<!-- Watch tab: live debugging while the tab is open. Two modes share one layout — "Data changes"
     (change streams: what was written) and "Queries" (the database profiler: how queries ran).
     Recordings live in watchTabs.svelte.ts, so they keep running while the tab is in the background. -->
<script lang="ts">
  import { untrack } from "svelte";
  import type { WatchTab } from "../stores/navigation.svelte";
  import { getWatch, type WatchMode } from "../stores/watchTabs.svelte";
  import type { Doc } from "../domain/doc";
  import WatchChanges from "./WatchChanges.svelte";
  import WatchQueries from "./WatchQueries.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tab, onopendocument, onopenquery }: {
    tab: WatchTab;
    onopendocument: (db: string, coll: string, doc: Doc) => void;
    onopenquery: (statement: string) => void;
  } = $props();

  const w = untrack(() => getWatch(tab));
  const scopeLabel = $derived(tab.coll ? `${tab.db}.${tab.coll}` : (tab.db ?? m.watch_scope_deployment()));
  const MODES: { key: WatchMode; label: () => string }[] = [
    { key: "changes", label: m.watch_mode_changes },
    { key: "queries", label: m.watch_mode_queries },
  ];
  const live = (k: WatchMode) => (k === "changes" ? w.changes.status : w.queries.status) === "recording";
</script>

{#snippet switcher()}
  <div class="modes" role="tablist" aria-label={m.watch_mode_label()}>
    {#each MODES as md (md.key)}
      <button role="tab" aria-selected={w.mode === md.key} class:on={w.mode === md.key} onclick={() => (w.mode = md.key)}>
        {md.label()}{#if live(md.key)}<span class="live-dot" aria-hidden="true"></span>{/if}
      </button>
    {/each}
  </div>
  <span class="scope" title={scopeLabel}>{scopeLabel}</span>
{/snippet}

<div class="watch">
  <!-- Both stay mounted so each keeps its scroll position and selection. -->
  <div class="pane" hidden={w.mode !== "changes"}>
    <WatchChanges {tab} w={w.changes} {switcher} {scopeLabel} {onopendocument} />
  </div>
  <div class="pane" hidden={w.mode !== "queries"}>
    <WatchQueries {tab} q={w.queries} {switcher} {onopenquery} />
  </div>
</div>

<style>
  .watch { height: 100%; min-height: 0; font-size: var(--fs); }
  .pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .pane[hidden] { display: none; }

  .modes { display: inline-flex; padding: 0.125rem; gap: 0.125rem; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border); }
  .modes button {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.375rem; padding: 0 0.625rem; border: 0;
    border-radius: var(--radius-sm); background: none; color: var(--muted); font-size: 0.75rem; font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  .modes button:hover:not(.on) { color: var(--fg); }
  .modes button.on { background: var(--panel); color: var(--fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
  .live-dot { width: 0.375rem; height: 0.375rem; border-radius: 50%; background: var(--danger); animation: blink 1.4s ease-in-out infinite; }
  .scope { flex: none; font-family: var(--mono); color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }

  /* ── Shared by both modes ── */
  .watch :global(.bar) {
    display: flex; align-items: center; gap: 0.625rem; height: 2.375rem; flex: none; padding: 0 0.625rem;
    background: var(--panel); border-bottom: 1px solid var(--border); min-width: 0;
  }
  .watch :global(.spacer) { flex: 1; }
  .watch :global(.state) { display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 600; white-space: nowrap; color: var(--muted); font-size: 0.75rem; }
  .watch :global(.state .dot) { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--c-overlay0); }
  .watch :global(.state.live) { color: var(--danger); }
  .watch :global(.state.live .dot) { background: var(--danger); animation: blink 1.4s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.25; } }
  .watch :global(.btn) {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.625rem; white-space: nowrap;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: var(--fs); cursor: pointer;
  }
  .watch :global(.btn:hover:not(:disabled)) { background: var(--hover); }
  .watch :global(.btn:disabled) { opacity: 0.45; cursor: default; }
  .watch :global(.btn.rec) { background: var(--danger); border-color: transparent; color: var(--on-accent); }
  .watch :global(.btn.primary) { background: var(--run); border-color: transparent; color: var(--on-accent); font-weight: 600; }
  .watch :global(.btn.primary:hover) { background: var(--run-hover); }
  .watch :global(.link) { border: 0; background: none; padding: 0; color: var(--link); cursor: pointer; font-size: var(--fs); }
  .watch :global(.link:hover) { text-decoration: underline; }

  .watch :global(.error) { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; flex: none; }
  .watch :global(.info) { background: var(--warn-bg2); color: var(--warn-fg); padding: 0.25rem 0.625rem; flex: none; font-size: 0.75rem; }

  .watch :global(.split) { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 42%); }
  .watch :global(.list) { container: watch-list / inline-size; position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--border); }
  .watch :global(.filters) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.5rem; padding: 0.375rem 0.625rem; flex: none; border-bottom: 1px solid var(--border); }
  .watch :global(.chips) { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .watch :global(.chip) {
    display: inline-flex; align-items: center; gap: 0.3125rem; height: 1.5rem; padding: 0 0.5rem;
    border: 1px solid var(--border); border-radius: 999px; background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer;
  }
  .watch :global(.chip .n) { color: var(--muted); font-variant-numeric: tabular-nums; }
  .watch :global(.chip.off) { opacity: 0.45; text-decoration: line-through; }
  .watch :global(.chip::before) { content: ""; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--op); }
  .watch :global(.search) {
    flex: 1 1 9rem; min-width: 8rem; max-width: 18rem; height: 1.625rem; padding: 0 0.5rem; border: 1px solid var(--border);
    border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs);
  }
  .watch :global(.search:focus) { outline: none; border-color: var(--accent); }
  .watch :global(.scroller) { flex: 1; min-height: 0; overflow: auto; outline: none; }
  .watch :global(.row) {
    display: grid; align-items: center; gap: 0.5rem; padding: 0 0.625rem; box-sizing: border-box; cursor: default;
    border-bottom: 1px solid var(--row-divider);
  }
  .watch :global(.row > span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .watch :global(.row:hover:not(.head)) { background: var(--row-hover); }
  .watch :global(.row.selected) { background: var(--row-selected); box-shadow: inset 2px 0 var(--accent); }
  .watch :global(.row.head) { height: 1.625rem; flex: none; color: var(--th-fg); font-size: 0.75rem; font-weight: 600; background: var(--bg); border-bottom: 1px solid var(--border); }
  .watch :global(.time) { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .watch :global(.mono) { font-family: var(--mono); font-size: 0.75rem; }
  .watch :global(.sum) { color: var(--muted); font-family: var(--mono); font-size: 0.75rem; }
  .watch :global(.badge) {
    display: inline-block; padding: 0 0.375rem; border-radius: var(--radius-sm); font-size: 0.6875rem; font-weight: 600;
    line-height: 1.125rem; text-transform: uppercase; letter-spacing: 0.02em;
    color: var(--op); background: color-mix(in srgb, var(--op) 13%, var(--panel));
  }
  .watch :global(.empty) { height: 100%; box-sizing: border-box; padding: 2rem 1rem; color: var(--muted); text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
  .watch :global(.pulse) { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--danger); animation: blink 1.4s ease-in-out infinite; }
  .watch :global(.new-pill) {
    position: absolute; left: 50%; bottom: 0.75rem; transform: translateX(-50%); padding: 0.25rem 0.75rem;
    border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.75rem; cursor: pointer; box-shadow: var(--shadow-sm);
  }

  .watch :global(.detail) { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--panel); }
  .watch :global(.d-head) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; padding: 0.5rem 0.75rem 0.25rem; white-space: nowrap; }
  .watch :global(.d-time) { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
  .watch :global(.d-sub) { padding: 0 0.75rem 0.5rem; font-family: var(--mono); font-size: 0.75rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .watch :global(.sep) { margin: 0 0.375rem; }
  .watch :global(.seg) { display: flex; gap: 0.125rem; padding: 0 0.75rem; border-bottom: 1px solid var(--border); }
  .watch :global(.seg button) {
    border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); padding: 0.375rem 0.5rem; font-size: var(--fs); cursor: pointer;
  }
  .watch :global(.seg button.on) { color: var(--fg); border-bottom-color: var(--accent); }
  .watch :global(.seg button:disabled) { opacity: 0.4; cursor: default; }
  .watch :global(.d-body) { flex: 1; min-height: 0; overflow: auto; padding: 0.625rem 0.75rem; }
  .watch :global(.caption) { color: var(--muted); font-size: 0.75rem; margin-bottom: 0.5rem; line-height: 1.45; }
  .watch :global(.caption.warn) { color: var(--warn-fg); background: var(--warn-bg2); padding: 0.375rem 0.5rem; border-radius: var(--radius); }
  .watch :global(.json) {
    margin: 0; font-family: var(--mono); font-size: 0.75rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem 0.625rem;
  }
</style>
