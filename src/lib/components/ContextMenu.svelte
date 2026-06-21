<script lang="ts">
  export type MenuItem = { label: string; action: string; disabled?: boolean; children?: MenuItem[] };

  let { x, y, items, onselect, onclose }: {
    x: number; y: number; items: MenuItem[];
    onselect: (action: string) => void; onclose: () => void;
  } = $props();

  let openIdx = $state<number | null>(null);

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
  .menu { position: fixed; z-index: 100; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); padding: 4px 0; min-width: 160px; }
  .item { display: block; width: 100%; text-align: left; border: none; background: none; padding: 6px 14px; font-size: 13px; cursor: pointer; }
  .item:hover:not(:disabled) { background: #f0f0f0; }
  .item:disabled { color: #bbb; cursor: default; }
  .sub { position: relative; }
  .item.parent { display: flex; justify-content: space-between; align-items: center; }
  .caret { color: #999; margin-left: 12px; }
  .submenu { position: absolute; left: 100%; top: -4px; }
</style>
