<script lang="ts">
  export type MenuItem = { label: string; action: string; disabled?: boolean };

  let {
    x,
    y,
    items,
    onselect,
    onclose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    onselect: (action: string) => void;
    onclose: () => void;
  } = $props();

  function choose(it: MenuItem) {
    if (it.disabled) return;
    onselect(it.action);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onclick={onclose} oncontextmenu={onclose} onkeydown={onKey} />

<div class="menu" style="left:{x}px; top:{y}px" role="menu">
  {#each items as it}
    <button
      class="item"
      role="menuitem"
      disabled={it.disabled}
      onclick={(e) => {
        e.stopPropagation();
        choose(it);
      }}>{it.label}</button>
  {/each}
</div>

<style>
  .menu { position: fixed; z-index: 100; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); padding: 4px 0; min-width: 160px; }
  .item { display: block; width: 100%; text-align: left; border: none; background: none; padding: 6px 14px; font-size: 13px; cursor: pointer; }
  .item:hover:not(:disabled) { background: #f0f0f0; }
  .item:disabled { color: #bbb; cursor: default; }
</style>
