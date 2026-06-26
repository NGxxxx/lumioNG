<script lang="ts">
  import type { Active, ContextKind, WorkTab } from "../stores/navigation.svelte";
  import * as m from "$lib/paraglide/messages";

  type SessionInfo = { id: string; label: string; color: string };

  let {
    contextTabs,
    workTabs,
    sessions = [],
    active,
    onShowContext,
    onActivateWork,
    onCloseWork,
    onNewQuery,
  }: {
    contextTabs: { kind: ContextKind; label: string }[];
    workTabs: WorkTab[];
    sessions?: SessionInfo[];
    active: Active;
    onShowContext: (kind: ContextKind) => void;
    onActivateWork: (id: number) => void;
    onCloseWork: (id: number) => void;
    onNewQuery: () => void;
  } = $props();

  function sessionOf(sessionId: string): SessionInfo | undefined {
    return sessions.find((s) => s.id === sessionId);
  }

  function shorten(s: string): string {
    return s.length > 14 ? s.slice(0, 12) + "…" : s;
  }
  function workTitle(t: WorkTab): string {
    if (t.kind === "query") return m.tab_bar_query_title({ seq: t.seq });
    if (t.mode === "insert") return m.tab_bar_doc_new({ coll: t.coll });
    return `${t.coll} / ${t.idText ? shorten(t.idText) : "?"}`;
  }
</script>

<div class="tabbar">
  {#each contextTabs as c (c.kind)}
    <button
      class="tab context"
      class:active={active?.zone === "context" && active.kind === c.kind}
      onclick={() => onShowContext(c.kind)}
    >
      {#if c.kind === "host"}
        <!-- Mongo leaf / green -->
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke="#13aa52" stroke-width="2"/>
          <path d="M5 5.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6" fill="none" stroke="#13aa52" stroke-width="2"/>
        </svg>
      {:else if c.kind === "database"}
        <!-- Purple cylinder -->
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="3.5" rx="5" ry="2" fill="none" stroke="#8a6cb5" stroke-width="1.2"/>
          <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9" fill="none" stroke="#8a6cb5" stroke-width="1.2"/>
        </svg>
      {:else if c.kind === "collection"}
        <!-- Yellow table -->
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="#caa84e" stroke-width="1.1"/>
          <path d="M2 6h12" stroke="#caa84e" stroke-width="0.9"/>
        </svg>
      {:else if c.kind === "data"}
        <!-- Blue grid -->
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="#2f7dd1" stroke-width="1.1"/>
          <path d="M2 6h12M2 9.5h12M6.5 2.5v11" stroke="#2f7dd1" stroke-width="0.8"/>
        </svg>
      {/if}
      {c.label}
    </button>
  {/each}
  {#if contextTabs.length && workTabs.length}
    <div class="divider"></div>
  {/if}
  {#each workTabs as t (t.id)}
    {@const sess = sessionOf(t.sessionId)}
    <div
      class="tab work"
      class:active={active?.zone === "work" && active.id === t.id}
      title={sess?.label}
    >
      <span
        class="session-dot"
        style="background:{sess?.color ?? '#aaa'}"
        data-color={sess?.color ?? '#aaa'}
        aria-hidden="true"
      ></span>
      <button class="label" onclick={() => onActivateWork(t.id)} title={workTitle(t)}>{workTitle(t)}</button>
      <button class="x" onclick={() => onCloseWork(t.id)} aria-label={m.tab_bar_close()}>×</button>
    </div>
  {/each}
  <button class="tab newq" onclick={onNewQuery} title={m.tab_bar_new_query()}>+</button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: flex-end;
    height: 1.75rem;
    flex: none;
    padding: 0 0.25rem;
    gap: 0.125rem;
    border-bottom: 1px solid var(--gray-c4);
    background: var(--bg);
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.25rem 0.8125rem;
    font-size: 0.75rem;
    border: 1px solid var(--gray-c4);
    border-bottom: none;
    border-radius: 0.25rem 0.25rem 0 0;
    margin-bottom: -1px;
    cursor: default;
    white-space: nowrap;
    max-width: 13.75rem;
  }

  .tab.context {
    background: var(--tab-inactive-bg);
    color: var(--gray-55);
  }

  .tab.context.active {
    background: var(--panel);
    color: var(--tab-active-fg);
    font-weight: 600;
    position: relative;
    z-index: 2;
    box-shadow: inset 0 2px 0 var(--tab-active-border);
  }

  .tab.work {
    background: var(--tab-inactive-bg);
    color: var(--gray-55);
  }

  .tab.work.active {
    background: var(--panel);
    color: var(--tab-active-fg);
    font-weight: 600;
    position: relative;
    z-index: 2;
    box-shadow: inset 0 2px 0 var(--tab-active-border);
  }

  .divider {
    width: 1px;
    background: var(--gray-c4);
    margin: 0.25rem 0.375rem;
    align-self: stretch;
  }

  .label {
    border: none;
    background: none;
    padding: 0;
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 11.25rem;
    color: inherit;
  }

  .x {
    border: none;
    background: none;
    padding: 0 0 0 0.25rem;
    cursor: pointer;
    color: var(--muted);
    font-size: 0.875rem;
    line-height: 1;
  }

  .x:hover {
    color: var(--fg);
  }

  .newq { align-self: flex-end; margin-bottom: -1px; padding: 0.25rem 0.75rem; font-weight: 600; color: var(--gray-55); cursor: pointer; }
  .newq:hover { background: var(--panel); }

  .session-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
</style>
