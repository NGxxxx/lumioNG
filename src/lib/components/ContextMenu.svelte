<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { registerContextMenu } from "./contextMenuController";
  import type { MenuItem } from "../domain/gridView";

  let { x, y, items, onselect, onclose }: {
    x: number; y: number; items: MenuItem[];
    onselect: (action: string) => void; onclose: () => void;
  } = $props();

  let openIdx = $state<number | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);
  // Opening never moves focus (that would blur an inline cell edit); the first arrow key does, and
  // closing hands focus back only if the menu had it.
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // Single-menu coordinator: mounting this menu closes any other open menu, preventing two menus being open at once.
  let unregister: (() => void) | null = null;
  onMount(() => { unregister = registerContextMenu(onclose); });
  let hasFocus = false;
  onDestroy(() => {
    unregister?.();
    if (hasFocus) returnFocus?.focus();
  });

  function choose(it: MenuItem) {
    if (it.disabled || it.children) return;
    onselect(it.action);
  }
  function onKey(e: KeyboardEvent) { if (e.key === "Escape") onclose(); }

  const enabledItems = (menu: Element | null) =>
    menu ? [...menu.querySelectorAll<HTMLButtonElement>(":scope > button.item, :scope > .sub > button.item")].filter((b) => !b.disabled) : [];

  async function openSub(i: number) {
    openIdx = i;
    await tick();
    enabledItems(rootEl?.querySelector(".submenu") ?? null)[0]?.focus();
  }

  // Capture phase: while the menu is open, arrow keys belong to it, not to the grid or editor behind it.
  function onKeyCapture(e: KeyboardEvent) {
    if (!rootEl || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const active = document.activeElement as HTMLElement | null;
    const inSub = !!active?.closest(".submenu");
    const menu = inSub ? active!.closest(".submenu") : rootEl;
    const list = enabledItems(menu);
    if (!active || !rootEl.contains(active)) {
      enabledItems(rootEl)[e.key === "ArrowUp" ? enabledItems(rootEl).length - 1 : 0]?.focus();
      return;
    }
    const at = list.indexOf(active as HTMLButtonElement);
    if (e.key === "ArrowDown") list[(at + 1) % list.length]?.focus();
    else if (e.key === "ArrowUp") list[(at - 1 + list.length) % list.length]?.focus();
    else if (e.key === "ArrowRight" && !inSub && active.classList.contains("parent")) void openSub(Number(active.dataset.idx));
    else if (e.key === "ArrowLeft" && inSub) {
      const parent = active.closest(".sub")?.querySelector<HTMLButtonElement>("button.parent");
      openIdx = null;
      parent?.focus();
    }
  }
</script>

<svelte:window onclick={onclose} oncontextmenu={onclose} onkeydown={onKey} onkeydowncapture={onKeyCapture} />

<div class="menu" style="left:{x}px; top:{y}px" role="menu" bind:this={rootEl}
  onfocusin={() => (hasFocus = true)}
  onfocusout={(e) => { if (!rootEl?.contains(e.relatedTarget as Node | null)) hasFocus = false; }}>
  {#each items as it, i}
    {#if it.children}
      <div class="sub" role="none">
        <button class="item parent" role="menuitem" aria-haspopup="true" aria-expanded={openIdx === i} disabled={it.disabled}
          data-idx={i}
          onclick={(e) => { e.stopPropagation(); if (openIdx === i) openIdx = null; else void openSub(i); }}
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
  .menu { position: fixed; z-index: 1000; background: var(--popover); border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.25rem; min-width: 12rem; }
  .item { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--c-subtext1); height: 1.875rem; padding: 0 0.625rem; border-radius: var(--radius-sm); font-size: var(--fs); cursor: pointer; white-space: nowrap; }
  .item:hover:not(:disabled) { background: var(--menu-hover); color: var(--fg); }
  .item:disabled { color: var(--gray-b8); cursor: default; }
  .sub { position: relative; }
  .item.parent { display: flex; justify-content: space-between; align-items: center; }
  .caret { color: var(--gray-99); margin-left: 0.75rem; }
  .submenu { position: absolute; left: calc(100% + 0.25rem); top: -0.3125rem; }
</style>
