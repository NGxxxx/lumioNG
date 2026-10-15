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
</script>

<div class="switcher" role="tablist" aria-label={label}>
  {#each items as it (it.key)}
    <button role="tab" aria-selected={it.key === value} class:active={it.key === value} onclick={() => onchange(it.key)}>
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
