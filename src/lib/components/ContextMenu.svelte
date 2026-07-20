<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { registerContextMenu } from "./contextMenuController";
  import type { MenuItem } from "../domain/gridView";

  let { x, y, items, onselect, onclose }: {
    x: number; y: number; items: MenuItem[];
    onselect: (action: string) => void; onclose: () => void;
  } = $props();

  let openIdx = $state<number | null>(null);

  // Single-menu coordinator: mounting this menu closes any other open menu, preventing two menus being open at once.
  let unregister: (() => void) | null = null;
  onMount(() => { unregister = registerContextMenu(onclose); });
  onDestroy(() => unregister?.());

  function choose(it: MenuItem) {
    if (it.disabled || it.children) return;
    onselect(it.action);
  }
  function onKey(e: KeyboardEvent) { if (e.key === "Escape") onclose(); }
</script>

<svelte:window onclick={onclose} oncontextmenu={onclose} onkeydown={onKey} />

<div class="menu" style="left:{x}px; top:{y}px" role="menu">
  {#each items as it, i}
    {#if it.children}
      <div class="sub" role="none">
        <button class="item parent" role="menuitem" aria-haspopup="true" disabled={it.disabled}
          onmouseenter={() => (openIdx = i)} onmouseleave={() => (openIdx = null)}>
          <span>{it.label}</span><span class="caret">▸</span>
        </button>
        {#if openIdx === i}
          <div class="menu submenu" role="menu" tabindex="-1" onmouseenter={() => (openIdx = i)} onmouseleave={() => (openIdx = null)}>
            {#each it.children as ch}
              <button class="item" role="menuitem" disabled={ch.disabled}
                onclick={(e) => { e.stopPropagation(); choose(ch); }}>{ch.label}</button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button class="item" role="menuitem" disabled={it.disabled}
        onclick={(e) => { e.stopPropagation(); choose(it); }}>{it.label}</button>
    {/if}
  {/each}
</div>

<style>
  .menu { position: fixed; z-index: 1000; background: var(--panel); border: 1px solid var(--gray-c4); border-radius: 0.25rem; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); padding: 0.25rem 0; min-width: 10rem; }
  .item { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--fg); padding: 0.375rem 0.875rem; font-size: 0.8125rem; cursor: pointer; }
  .item:hover:not(:disabled) { background: var(--bg); }
  .item:disabled { color: var(--gray-b8); cursor: default; }
  .sub { position: relative; }
  .item.parent { display: flex; justify-content: space-between; align-items: center; }
  .caret { color: var(--gray-99); margin-left: 0.75rem; }
  .submenu { position: absolute; left: 100%; top: -0.25rem; }
</style>
