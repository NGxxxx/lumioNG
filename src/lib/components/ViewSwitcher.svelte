<!-- src/lib/components/ViewSwitcher.svelte — segmented control for switching a page's views (Data · Schema · …). -->
<script lang="ts">
  let {
    items,
    value,
    onchange,
    label,
  }: {
    items: { key: string; label: string }[];
    value: string;
    onchange: (key: string) => void;
    /** Accessible name of the tablist. */
    label: string;
  } = $props();

  /** Arrow keys move to the previous / next view (roving tabindex: only the active tab is tabbable). */
  function onkey(e: KeyboardEvent, i: number) {
    let next: number;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    onchange(items[next].key);
    const tabs = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]");
    tabs?.[next]?.focus();
  }
</script>

<div class="switcher" role="tablist" aria-label={label}>
  {#each items as it, i (it.key)}
    <button
      role="tab"
      aria-selected={it.key === value}
      tabindex={it.key === value ? 0 : -1}
      class:active={it.key === value}
      onclick={() => onchange(it.key)}
      onkeydown={(e) => onkey(e, i)}
    >
      {it.label}
    </button>
  {/each}
</div>

<style>
  .switcher {
    display: flex; align-items: center; gap: 0.125rem; padding: 0.125rem; flex: none;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);
  }
  button {
    height: 1.5rem; padding: 0 0.625rem; border: none; border-radius: var(--radius-sm);
    background: none; color: var(--muted); font-size: 0.75rem; cursor: pointer; white-space: nowrap;
  }
  button:hover { color: var(--fg); }
  button.active { background: var(--menu-hover); color: var(--fg); box-shadow: 0 0 0 1px var(--c-surface1); }
</style>
