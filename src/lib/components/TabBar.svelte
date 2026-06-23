<script lang="ts">
  import type { Active, ContextKind, WorkTab } from "../stores/navigation.svelte";
  import * as m from "$lib/paraglide/messages";

  let {
    contextTabs,
    workTabs,
    active,
    onShowContext,
    onActivateWork,
    onCloseWork,
    onNewQuery,
  }: {
    contextTabs: { kind: ContextKind; label: string }[];
    workTabs: WorkTab[];
    active: Active;
    onShowContext: (kind: ContextKind) => void;
    onActivateWork: (id: number) => void;
    onCloseWork: (id: number) => void;
    onNewQuery: () => void;
  } = $props();

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
    <div class="tab work" class:active={active?.zone === "work" && active.id === t.id}>
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
    height: 28px;
    flex: none;
    padding: 0 4px;
    gap: 2px;
    border-bottom: 1px solid #c8c8c8;
    background: var(--bg);
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 13px;
    font-size: 12px;
    border: 1px solid #c8c8c8;
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    margin-bottom: -1px;
    cursor: default;
    white-space: nowrap;
    max-width: 220px;
  }

  .tab.context {
    background: var(--tab-inactive-bg);
    color: #555;
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
    color: #555;
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
    background: #c8c8c8;
    margin: 4px 6px;
    align-self: stretch;
  }

  .label {
    border: none;
    background: none;
    padding: 0;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
    color: inherit;
  }

  .x {
    border: none;
    background: none;
    padding: 0 0 0 4px;
    cursor: pointer;
    color: var(--muted);
    font-size: 14px;
    line-height: 1;
  }

  .x:hover {
    color: var(--fg);
  }

  .newq { align-self: flex-end; margin-bottom: -1px; padding: 4px 12px; font-weight: 600; color: #555; cursor: pointer; }
  .newq:hover { background: var(--panel); }
</style>
