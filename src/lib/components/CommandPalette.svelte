<!-- src/lib/components/CommandPalette.svelte — ⌘K overlay: rendering + keyboard glue only; ranking lives in domain/palette. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "#lib/stores/modalStack.js";
  import { filterPalette, groupMatches, splitByRanges, type PaletteItem, type PaletteMatch } from "../domain/palette";
  import * as m from "#lib/paraglide/messages.js";

  let {
    items,
    context = [],
    onrun,
    onclose,
  }: {
    items: PaletteItem[];
    /** Small chips above the input naming where commands will act (connection, namespace). */
    context?: string[];
    onrun: (id: string) => void;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let activeIndex = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();

  const matches = $derived(filterPalette(items, query));
  const groups = $derived(groupMatches(matches));
  // Flat order as rendered (group by group), so arrow keys walk the list top to bottom.
  const flat = $derived(groups.flatMap((g) => g.matches));

  function run(match: PaletteMatch | undefined) {
    if (!match) return;
    onclose();
    onrun(match.item.id);
  }

  onMount(() => {
    input?.focus();
    return pushModal({ onEscape: () => onclose(), onEnter: () => run(flat[activeIndex]) });
  });

  async function move(delta: number) {
    if (flat.length === 0) return;
    activeIndex = (activeIndex + delta + flat.length) % flat.length;
    await tick();
    list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  }
</script>

<div class="backdrop" use:portal role="presentation" use:backdropClose={onclose}>
  <div class="palette" role="dialog" aria-modal="true" aria-label={m.palette_title()}>
    {#if context.length}
      <div class="context">
        {#each context as c, i (i)}<span class="ctx">{c}</span>{/each}
      </div>
    {/if}
    <input
      bind:this={input}
      bind:value={() => query, (v) => { query = v; activeIndex = 0; }}
      onkeydown={onKeydown}
      placeholder={m.palette_placeholder()}
      aria-label={m.palette_placeholder()}
      aria-controls="palette-list"
      aria-activedescendant={flat.length ? `palette-opt-${activeIndex}` : undefined}
      spellcheck="false"
      autocomplete="off"
    />
    <div class="list" id="palette-list" role="listbox" bind:this={list}>
      {#if flat.length === 0}
        <div class="empty">{m.palette_empty()}</div>
      {/if}
      {#each groups as g (g.group)}
        <div class="group" role="presentation">{g.group}</div>
        {#each g.matches as match (match.item.id)}
          {@const idx = flat.indexOf(match)}
          <button
            class="item"
            class:active={idx === activeIndex}
            id={`palette-opt-${idx}`}
            data-index={idx}
            role="option"
            aria-selected={idx === activeIndex}
            tabindex="-1"
            onmousemove={() => (activeIndex = idx)}
            onclick={() => run(match)}
          >
            <span class="label">
              {#each splitByRanges(match.item.label, match.ranges) as part, pi (pi)}
                {#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}
              {/each}
            </span>
            {#if match.item.detail}<span class="detail">{match.item.detail}</span>{/if}
            {#if match.item.shortcut}<kbd>{match.item.shortcut}</kbd>{/if}
          </button>
        {/each}
      {/each}
    </div>
    <div class="footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> {m.palette_hint_navigate()}</span>
      <span><kbd>↵</kbd> {m.palette_hint_run()}</span>
      <span class="end"><kbd>esc</kbd> {m.palette_hint_close()}</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 1100; background: var(--backdrop);
    display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh;
  }
  .palette {
    width: min(40rem, calc(100vw - 2rem)); max-height: 70vh; display: flex; flex-direction: column;
    background: var(--popover); border: 1px solid var(--c-surface1); border-radius: 0.75rem;
    box-shadow: var(--shadow-lg); overflow: hidden;
  }
  .context { display: flex; gap: 0.375rem; padding: 0.75rem 0.875rem 0; }
  .ctx {
    font-size: 0.75rem; color: var(--c-subtext1); background: var(--hover);
    padding: 0.125rem 0.5rem; border-radius: var(--radius-sm);
  }
  input {
    border: none; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent;
    padding: 0.875rem 1.125rem; font-size: 1rem; color: var(--fg);
  }
  input:focus-visible { box-shadow: none; border-color: var(--border); }
  input::placeholder { color: var(--muted); }
  .list { overflow-y: auto; padding: 0.375rem 0 0.5rem; }
  .empty { padding: 1.25rem 1.125rem; color: var(--muted); }
  .group { padding: 0.625rem 1.125rem 0.25rem; font-size: 0.71875rem; font-weight: 500; color: var(--muted); }
  .item {
    display: flex; align-items: center; gap: 0.75rem; width: calc(100% - 0.75rem); margin: 0 0.375rem;
    height: 2.25rem; padding: 0 0.75rem; border: none; border-radius: var(--radius);
    background: transparent; color: var(--c-subtext1); font-size: 0.84375rem; text-align: left; cursor: pointer;
  }
  .item.active { background: var(--menu-hover); color: var(--fg); }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  mark { background: none; color: var(--accent); font-weight: 600; }
  .detail { color: var(--muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item kbd { margin-left: auto; }
  kbd {
    display: inline-flex; align-items: center; justify-content: center; min-width: 1.125rem; box-sizing: border-box;
    font-family: var(--mono); font-size: 0.6875rem; color: var(--muted);
    padding: 0.0625rem 0.3125rem; border-radius: var(--radius-sm);
    background: var(--hover); border: 1px solid var(--c-surface1);
  }
  .footer {
    display: flex; align-items: center; gap: 1rem; padding: 0.5rem 1rem;
    border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--muted);
  }
  .footer span { display: inline-flex; align-items: center; gap: 0.25rem; }
  .footer .end { margin-left: auto; }
</style>
