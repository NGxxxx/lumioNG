<script lang="ts">
  import type { Active, Page, WorkTab } from "../stores/navigation.svelte";
  import { queryLibrary } from "../stores/queryLibrary.svelte";
  import { peekWatch } from "../stores/watchTabs.svelte";
  import * as m from "#lib/paraglide/messages.js";

  type SessionInfo = { id: string; label: string; color: string; environment?: string };

  let {
    destination,
    workTabs,
    sessions = [],
    active,
    onShowDestination,
    onActivateWork,
    onCloseWork,
    onNewQuery,
  }: {
    /** The single, non-closable tab for the selected host / database / collection page; null when not connected. */
    destination: { label: string; page: Page } | null;
    workTabs: WorkTab[];
    sessions?: SessionInfo[];
    active: Active;
    onShowDestination: () => void;
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
    if (t.kind === "watch") {
      const target = t.idText ? `${t.coll} / ${shorten(t.idText)}` : (t.coll ?? t.db ?? m.watch_scope_deployment());
      return m.tab_bar_watch_title({ target });
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
  {#if destination}
    <button
      class="tab destination"
      class:active={active?.zone === "destination"}
      onclick={onShowDestination}
      title={destination.label}
    >
      {#if destination.page === "host"}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="4" rx="1" /><rect x="2" y="9.5" width="12" height="4" rx="1" />
        </svg>
      {:else if destination.page === "database"}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
          <ellipse cx="8" cy="3.5" rx="5" ry="2" /><path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9" />
        </svg>
      {:else}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1" /><path d="M2 6h12M6.5 6v7.5" />
        </svg>
      {/if}
      <span class="dest-label">{destination.label}</span>
    </button>
  {/if}
  {#if destination && workTabs.length}
    <div class="divider"></div>
  {/if}
  <div class="work-tabs" onwheel={onWheel}>
    <div class="work-tabs-inner">
      {#each workTabs as t (t.id)}
        {@const sess = sessionOf(t.sessionId)}
        {@const dot = sess?.environment === "prod" ? "var(--danger)" : (sess?.color ?? "var(--muted)")}
        <div
          class="tab work"
          class:active={active?.zone === "work" && active.id === t.id}
          title={sess?.label}
        >
          <span
            class="session-dot"
            style="background:{dot}"
            data-color={dot}
            aria-hidden="true"
          ></span>
          {#if t.kind === "watch"}
            <span class="rec" class:live={peekWatch(t.id)?.recording ?? false} aria-hidden="true"></span>
          {/if}
          <button class="label" onclick={() => onActivateWork(t.id)} title={workTitle(t)}>{workTitle(t)}</button>
          <button class="x" onclick={() => onCloseWork(t.id)} aria-label={m.tab_bar_close()}>×</button>
        </div>
      {/each}
    </div>
  </div>
  <button class="tab newq" onclick={onNewQuery} title={m.tab_bar_new_query()}>+</button>
</div>

<style>
  /* Pill tabs on the panel's top strip: context tabs (Host/Database/Collection/Data), a divider,
     then the scrollable work tabs (queries, documents) and "+". */
  .tabbar {
    display: flex;
    align-items: center;
    flex: none;
    height: 2.375rem;
    padding: 0 0.375rem;
    gap: 0.125rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .destination { flex: none; }
  /* Watch tabs: a hollow ring when paused, a blinking red dot while recording. */
  .rec { flex: none; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; border: 1.5px solid var(--c-overlay0); box-sizing: border-box; }
  .rec.live { border-color: var(--danger); background: var(--danger); animation: rec-blink 1.4s ease-in-out infinite; }
  @keyframes rec-blink { 50% { opacity: 0.3; } }
  .dest-label { overflow: hidden; text-overflow: ellipsis; }
  /* Horizontal scrollbars render at an element's bottom edge — flip the scroller so the scrollbar
     lands on top, then flip the inner row back. flex-grow:0 keeps "+" right after the last tab;
     flex-shrink:1 + min-width:0 shrink-then-scroll once the strip is full. */
  .work-tabs {
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    transform: scaleY(-1);
  }
  .work-tabs::-webkit-scrollbar { height: 0.25rem; }
  .work-tabs::-webkit-scrollbar-track { background: transparent; }
  .work-tabs::-webkit-scrollbar-thumb { background: var(--gray-b8); border-radius: var(--radius); }
  .work-tabs-inner {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    width: max-content;
    padding: 0.375rem 0;
    transform: scaleY(-1);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    height: 1.625rem;
    box-sizing: border-box;
    padding: 0 0.625rem;
    font-size: 0.78125rem;
    border: none;
    border-radius: var(--radius);
    cursor: default;
    white-space: nowrap;
    max-width: 13.75rem;
    background: transparent;
    color: var(--muted);
  }

  .tab:hover:not(.active) {
    background: var(--hover);
    color: var(--fg);
  }

  .tab.active {
    background: var(--menu-hover);
    color: var(--tab-active-fg);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .divider {
    width: 1px;
    height: 1rem;
    background: var(--border);
    margin: 0 0.375rem;
    flex: none;
  }

  .label {
    border: none;
    background: none;
    padding: 0;
    font-size: inherit;
    font-weight: inherit;
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
    width: 1rem;
    height: 1rem;
    padding: 0;
    margin-right: -0.25rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--muted);
    font-size: 0.875rem;
    line-height: 1;
    opacity: 0;
  }
  .tab:hover .x, .tab.active .x, .x:focus-visible { opacity: 1; }
  .x:hover { color: var(--fg); background: var(--hover); }

  .newq {
    flex: none; width: 1.625rem; justify-content: center; padding: 0;
    font-size: 1rem; font-weight: var(--fw); color: var(--muted); cursor: pointer;
  }
  .newq:hover { background: var(--hover); color: var(--fg); }

  .session-dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
</style>
