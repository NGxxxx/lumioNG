<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  let {
    connected,
    onsession,
    onrefresh,
    onquit,
  }: { connected: boolean; onsession: () => void; onrefresh: () => void; onquit: () => void } = $props();

  type Item = { label: string; run?: () => void; disabled?: boolean };
  let openMenu = $state<string | null>(null);

  const menus: { name: string; items: Item[]; disabled?: boolean }[] = $derived([
    {
      name: "File",
      items: [
        { label: "Refresh", run: onrefresh, disabled: !connected },
        { label: "Quit", run: onquit },
      ],
    },
    { name: "Edit", items: [{ label: "Copy", disabled: true }] },
    { name: "Search", items: [{ label: "Find", disabled: true }] },
    { name: "Query", items: [{ label: "Run query", disabled: true }] },
    { name: "Tools", items: [{ label: "Session manager", run: onsession }] },
    { name: "Go to", items: [], disabled: true },
    { name: "Help", items: [{ label: "About", disabled: true }] },
  ]);

  function toggle(name: string) {
    openMenu = openMenu === name ? null : name;
  }
  function choose(it: Item) {
    openMenu = null;
    if (!it.disabled && it.run) it.run();
  }
</script>

<svelte:window onclick={() => (openMenu = null)} />

<div class="menubar">
  {#each menus as m (m.name)}
    <div class="slot">
      <button
        class="top"
        class:active={openMenu === m.name}
        class:disabled={m.disabled}
        disabled={m.disabled}
        onclick={(e) => {
          e.stopPropagation();
          if (!m.disabled) toggle(m.name);
        }}>{m.name}</button
      >
      {#if openMenu === m.name && !m.disabled}
        <div class="dropdown">
          {#each m.items as it (it.label)}
            <button class="item" disabled={it.disabled} onclick={() => choose(it)}>{it.label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .menubar {
    display: flex;
    align-items: center;
    height: 24px;
    background: var(--bg);
    border-bottom: 1px solid #e2e2e2;
    padding: 0 4px;
    user-select: none;
    box-sizing: border-box;
  }
  .slot { position: relative; }
  .top {
    border: none;
    background: none;
    padding: 3px 9px;
    font-size: 12px;
    color: #222;
    border-radius: 2px;
    cursor: pointer;
    line-height: 1;
  }
  .top:hover:not(.disabled):not(:disabled),
  .top.active:not(.disabled):not(:disabled) { background: var(--menu-hover); }
  .top.disabled,
  .top:disabled { color: #aaa; cursor: default; }
  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 30;
    min-width: 160px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: 0 2px 6px rgba(0,0,0,.15);
  }
  .item {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 12px;
    color: #222;
  }
  .item:hover:not(:disabled) { background: var(--menu-hover); }
  .item:disabled { color: #aaa; cursor: default; }
</style>
