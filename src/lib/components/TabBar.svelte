<script lang="ts">
  import type { Active, ContextKind, WorkTab } from "../stores/navigation.svelte";
  import { queryLibrary } from "../stores/queryLibrary.svelte";
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
    if (t.kind === "query") {
      // Deleted/never-saved falls back to the seq title (association is kept; Save re-prompts).
      const name = t.savedQueryId != null ? queryLibrary.queryName(t.savedQueryId) : null;
      return name ?? m.tab_bar_query_title({ seq: t.seq });
    }
    if (t.mode === "insert") return m.tab_bar_doc_new({ coll: t.coll });
    return `${t.coll} / ${t.idText ? shorten(t.idText) : "?"}`;
  }

  // Plain vertical wheel also scrolls the tab strip horizontally.
  function onWheel(e: WheelEvent) {
    const el = e.currentTarget as HTMLDivElement;
    if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }
</script>

<div class="tabbar">
  <div class="context-tabs">
    {#each contextTabs as c (c.kind)}
      <button
        class="tab context"
        class:active={active?.zone === "context" && active.kind === c.kind}
        onclick={() => onShowContext(c.kind)}
      >
        {#if c.kind === "host"}
          <!-- Mongo leaf / green -->
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke="var(--accent)" stroke-width="2"/>
            <path d="M5 5.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6" fill="none" stroke="var(--accent)" stroke-width="2"/>
          </svg>
        {:else if c.kind === "database"}
          <!-- Purple cylinder -->
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <ellipse cx="8" cy="3.5" rx="5" ry="2" fill="none" stroke="var(--type-object)" stroke-width="1.2"/>
            <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9" fill="none" stroke="var(--type-object)" stroke-width="1.2"/>
          </svg>
        {:else if c.kind === "collection"}
          <!-- Yellow table -->
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="var(--warn)" stroke-width="1.1"/>
            <path d="M2 6h12" stroke="var(--warn)" stroke-width="0.9"/>
          </svg>
        {:else if c.kind === "data"}
          <!-- Blue grid -->
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="var(--link)" stroke-width="1.1"/>
            <path d="M2 6h12M2 9.5h12M6.5 2.5v11" stroke="var(--link)" stroke-width="0.8"/>
          </svg>
        {/if}
        {c.label}
      </button>
    {/each}
  </div>
  {#if contextTabs.length && workTabs.length}
    <div class="divider"></div>
  {/if}
  <div class="work-tabs" onwheel={onWheel}>
    <div class="work-tabs-inner">
      {#each workTabs as t (t.id)}
        {@const sess = sessionOf(t.sessionId)}
        <div
          class="tab work"
          class:active={active?.zone === "work" && active.id === t.id}
          title={sess?.label}
        >
          <span
            class="session-dot"
            style="background:{sess?.color ?? 'var(--muted)'}"
            data-color={sess?.color ?? 'var(--muted)'}
            aria-hidden="true"
          ></span>
          <button class="label" onclick={() => onActivateWork(t.id)} title={workTitle(t)}>{workTitle(t)}</button>
          <button class="x" onclick={() => onCloseWork(t.id)} aria-label={m.tab_bar_close()}>×</button>
        </div>
      {/each}
    </div>
  </div>
  <button class="tab newq" onclick={onNewQuery} title={m.tab_bar_new_query()}>+</button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: flex-end;
    flex: none;
    padding: 0 0.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  /* Explicit height on both — matching .work-tabs' total (tab row + reserve) exactly, so
     content-based auto-sizing can't put their bottom borders a pixel or two apart. */
  .context-tabs {
    display: flex;
    align-items: flex-end;
    flex: none;
    gap: 0.125rem;
    height: 2.25rem;
  }
  /* Horizontal scrollbars render at an element's bottom edge, colliding with bottom-anchored tabs — flip the scroller so the scrollbar lands on top, then flip the inner row back. */
  /* flex-grow:0 so this only takes the width of its own tabs — not the whole row — so the "+" button
     sits right after the last tab instead of pinned to the far right with a big empty gap when there
     are only a few tabs open. flex-shrink:1 + min-width:0 keep the "shrink to fit, then scroll
     internally" behavior once there are enough tabs to fill the available space. */
  .work-tabs {
    flex: 0 1 auto;
    min-width: 0;
    height: 2.25rem;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    transform: scaleY(-1);
  }
  .work-tabs::-webkit-scrollbar { height: 0.5rem; }
  .work-tabs::-webkit-scrollbar-track { background: transparent; }
  .work-tabs::-webkit-scrollbar-thumb { background: var(--gray-b8); border-radius: var(--radius); }
  .work-tabs-inner {
    display: flex;
    align-items: flex-start;
    gap: 0.125rem;
    width: max-content;
    transform: scaleY(-1);
  }

  /* Linear-style tabs: borderless, muted until hovered; the active tab is a raised card joined to the pane below. */
  .tab {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3125rem 0.75rem;
    font-size: var(--fs);
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    margin-bottom: -1px;
    cursor: default;
    white-space: nowrap;
    max-width: 13.75rem;
    background: transparent;
    color: var(--muted);
  }

  .tab:hover:not(.active) {
    background: var(--menu-hover);
    color: var(--fg);
  }

  .tab.active {
    background: var(--panel);
    border-color: var(--border);
    color: var(--tab-active-fg);
    font-weight: 500;
    position: relative;
    z-index: 2;
  }

  .divider {
    width: 1px;
    height: 1rem;
    background: var(--border);
    margin: 0 0.375rem 0.5rem;
    align-self: flex-end;
  }

  .label {
    border: none;
    background: none;
    padding: 0;
    font-size: var(--fs);
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

  .newq { flex: none; padding: 0.25rem 0.625rem; margin-bottom: 0.25rem; border-radius: var(--radius); font-weight: 500; color: var(--muted); cursor: pointer; border: none; background: none; }
  .newq:hover { background: var(--menu-hover); color: var(--fg); }

  .session-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
</style>
