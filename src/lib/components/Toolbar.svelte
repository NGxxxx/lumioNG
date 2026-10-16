<!-- src/lib/components/Toolbar.svelte — the main panel's header: breadcrumb, view switcher, and the active view's actions. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { tooltip } from "../actions/tooltip";
  import { SHORTCUTS, type Command, type CommandId } from "../domain/commands";
  import type { ToolbarEntry } from "../domain/toolbarLayout";
  import { formatCombo } from "../domain/shortcuts";
  import { detectPlatform } from "../stores/platform";
  import * as m from "#lib/paraglide/messages.js";

  let {
    entries,
    labels,
    commands,
    activeIds = new Set<CommandId>(),
    crumb = [],
    switcher,
  }: {
    /** What to show, in order — from `toolbarFor(view)`. */
    entries: ToolbarEntry[];
    labels: Partial<Record<CommandId, string>>;
    commands: Partial<Record<CommandId, Command>>;
    /** Toggle commands currently on (rendered pressed / checked). */
    activeIds?: Set<CommandId>;
    /** Where the actions apply (e.g. ["shop", "orders"]); the last segment is emphasized. */
    crumb?: string[];
    /** The page's view switcher, rendered after the breadcrumb. */
    switcher?: Snippet;
  } = $props();

  const plat = detectPlatform();
  const inline = $derived(entries.filter((e) => !e.overflow));
  const overflow = $derived(entries.filter((e) => e.overflow));
  let moreOpen = $state(false);
  let moreBtn: HTMLButtonElement | undefined = $state();

  /** Focuses the first enabled item when the ⋯ menu opens. */
  function focusFirst(node: HTMLElement) {
    node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    const menu = e.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      moreOpen = false;
      moreBtn?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      const down = e.key === "ArrowDown";
      if (n) items[at < 0 ? (down ? 0 : n - 1) : (at + (down ? 1 : n - 1)) % n].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      moreOpen = false;
    }
  }

  const labelOf = (id: CommandId) => labels[id] ?? id;
  const disabledOf = (id: CommandId) => !commands[id] || commands[id]!.disabled;
  const isToggle = (id: CommandId) => id.startsWith("view.toggle");

  /** Tooltip text: the label plus the command's shortcut, e.g. "Refresh (F5)". */
  function tt(id: CommandId): string {
    const combo = SHORTCUTS[id];
    return combo ? `${labelOf(id)} (${formatCombo(combo, plat)})` : labelOf(id);
  }

  function run(id: CommandId) {
    if (moreOpen) moreBtn?.focus();
    moreOpen = false;
    if (!disabledOf(id)) commands[id]?.run();
  }
</script>

<svelte:window onclick={() => (moreOpen = false)} />

{#snippet glyph(id: CommandId)}
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    {#if id === "file.refresh"}
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />
    {:else if id === "file.import"}
      <path d="M8 2v8M5 7l3 3 3-3M2.5 11v2.5h11V11" />
    {:else if id === "file.export"}
      <path d="M8 10V2M5 5l3-3 3 3M2.5 11v2.5h11V11" />
    {:else if id === "file.newDocument" || id === "file.newQuery"}
      <path d="M8 3v10M3 8h10" />
    {:else if id === "query.save"}
      <path d="M3 2.5h8l2.5 2.5v8.5h-10.5zM5.5 2.5v3h4.5v-3M5 13.5V9.5h6v4" />
    {:else if id === "query.aggregate"}
      <path d="M3 2.5h10l-4 5.5 4 5.5H3l4-5.5z" />
    {:else if id === "query.watch"}
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
    {:else if id === "grid.focusFilter"}
      <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
    {:else if id === "view.toggleWrap"}
      <path d="M2 4.5h12M2 8h8.5a2 2 0 0 1 0 4H9M2 11.5h4M10.5 10.5 9 12l1.5 1.5" />
    {:else if id === "view.toggleSavedQueries"}
      <path d="M4 2.5h8v11l-4-2.8-4 2.8z" />
    {:else}
      <circle cx="8" cy="8" r="1.5" />
    {/if}
  </svg>
{/snippet}

<div class="toolbar">
  <div class="crumb">
    {#each crumb as part, i (i)}
      {#if i > 0}<span class="slash" aria-hidden="true">/</span>{/if}
      <span class:strong={i === crumb.length - 1}>{part}</span>
    {/each}
  </div>
  {#if switcher}<div class="switcher">{@render switcher()}</div>{/if}
  <div class="spacer"></div>

  {#each inline as e (e.id)}
    {#if e.style === "primary"}
      <span class="tt" use:tooltip={tt(e.id)}>
        <button class="primary" disabled={disabledOf(e.id)} onclick={() => run(e.id)}>
          {@render glyph(e.id)}<span>{labelOf(e.id)}</span>
        </button>
      </span>
    {:else}
      <span class="tt" use:tooltip={tt(e.id)}>
        <button
          class="btn-icon"
          class:active={activeIds.has(e.id)}
          aria-label={labelOf(e.id)}
          aria-pressed={isToggle(e.id) ? activeIds.has(e.id) : undefined}
          disabled={disabledOf(e.id)}
          onclick={() => run(e.id)}
        >
          {@render glyph(e.id)}
        </button>
      </span>
    {/if}
  {/each}

  {#if overflow.length}
    <div class="more">
      <button
        class="btn-icon"
        class:active={moreOpen}
        bind:this={moreBtn}
        aria-label={m.toolbar_more()}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onclick={(ev) => { ev.stopPropagation(); moreOpen = !moreOpen; }}
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" /></svg>
      </button>
      {#if moreOpen}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="menu" role="menu" use:focusFirst onkeydown={onMenuKey}>
          {#each overflow as e (e.id)}
            <button
              class="item"
              role={isToggle(e.id) ? "menuitemcheckbox" : "menuitem"}
              aria-checked={isToggle(e.id) ? activeIds.has(e.id) : undefined}
              disabled={disabledOf(e.id)}
              onclick={() => run(e.id)}
            >
              {@render glyph(e.id)}
              <span class="item-label">{labelOf(e.id)}</span>
              {#if isToggle(e.id) && activeIds.has(e.id)}<span class="check" aria-hidden="true">✓</span>{/if}
              {#if SHORTCUTS[e.id]}<span class="hint">{formatCombo(SHORTCUTS[e.id]!, plat)}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Header row of the main panel: context breadcrumb on the left, actions grouped on the right. */
  .toolbar {
    display: flex;
    align-items: center;
    height: 2.5rem;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex: none;
    padding: 0 0.5rem 0 0.875rem;
    gap: 0.125rem;
    user-select: none;
    /* visible so the ⋯ menu can drop below the header */
    overflow: visible;
    position: relative;
    z-index: 3;
  }

  .spacer { flex: 1; }
  .switcher { flex: none; margin-left: 0.75rem; }
  .crumb {
    flex: 0 1 auto;
    min-width: 2rem;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--fs);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb .strong { color: var(--fg); font-weight: 600; }
  .slash { color: var(--c-overlay0); }

  /* Real box (not display:contents) so hover still fires while the inner button is disabled. */
  .tt {
    display: inline-flex;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.375rem;
    box-sizing: border-box;
    border: none;
    background: none;
    cursor: default;
    border-radius: var(--radius);
    line-height: 1;
    /* Icons draw in currentColor: muted by default, full strength on hover. Only Run (accent)
       and Delete/Stop (danger) keep a fixed color, since that color carries meaning. */
    color: var(--muted);
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--menu-hover);
    color: var(--fg);
  }

  .btn-icon:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .btn-icon.active {
    background: var(--selected);
    color: var(--accent);
  }

  .primary {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.75rem; margin-left: 0.375rem; padding: 0 0.75rem;
    border: none; border-radius: var(--radius); background: var(--run); color: var(--on-accent);
    font-size: var(--fs); font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .primary:hover:not(:disabled) { background: var(--run-hover); }
  .primary:disabled { opacity: 0.45; cursor: default; }
  .more { position: relative; display: inline-flex; }
  .menu {
    position: absolute; top: calc(100% + 0.25rem); right: 0; z-index: 30; min-width: 13rem; padding: 0.25rem;
    background: var(--popover); border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);
  }
  .item {
    display: flex; align-items: center; gap: 0.5rem; width: 100%; height: 1.875rem; padding: 0 0.625rem;
    border: none; border-radius: var(--radius-sm); background: none; color: var(--c-subtext1);
    font-size: var(--fs); text-align: left; cursor: pointer; white-space: nowrap;
  }
  .item:hover:not(:disabled) { background: var(--menu-hover); color: var(--fg); }
  .item:disabled { opacity: 0.45; cursor: default; }
  .item-label { flex: 1; }
  .check { color: var(--accent); }
  .hint { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; }
</style>
