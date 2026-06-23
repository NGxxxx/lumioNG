<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  import { getLocale, setLocale, type Locale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let {
    connected,
    onsession,
    onrefresh,
    onquit,
  }: { connected: boolean; onsession: () => void; onrefresh: () => void; onquit: () => void } = $props();

  // An item is either a leaf (with `run`) or a parent that opens a submenu (`children`).
  type Item = { label: string; run?: () => void; disabled?: boolean; checked?: boolean; children?: Item[] };
  let openMenu = $state<string | null>(null);
  let openSub = $state<string | null>(null);
  // Locale awaiting a reload confirmation; null when no switch is pending.
  let pendingLocale = $state<Locale | null>(null);

  const LOCALE_NAMES: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };

  const menus: { name: string; items: Item[]; disabled?: boolean }[] = $derived([
    {
      name: m.menu_file(),
      items: [
        { label: m.menu_refresh(), run: onrefresh, disabled: !connected },
        { label: m.menu_quit(), run: onquit },
      ],
    },
    { name: m.menu_edit(), items: [{ label: m.menu_copy(), disabled: true }] },
    {
      name: m.menu_view(),
      // Language lives in a submenu so Appearance / Font size can sit beside it later.
      items: [
        {
          label: m.menu_language(),
          children: [
            { label: LOCALE_NAMES.en, checked: getLocale() === "en", run: () => requestLocale("en") },
            { label: LOCALE_NAMES.vi, checked: getLocale() === "vi", run: () => requestLocale("vi") },
          ],
        },
      ],
    },
    { name: m.menu_query(), items: [{ label: m.menu_run_query(), disabled: true }] },
    { name: m.menu_tools(), items: [{ label: m.menu_session_manager(), run: onsession }] },
    { name: m.menu_go_to(), items: [], disabled: true },
    { name: m.menu_help(), items: [{ label: m.menu_about(), disabled: true }] },
  ]);

  function closeAll() {
    openMenu = null;
    openSub = null;
  }
  function toggle(name: string) {
    openMenu = openMenu === name ? null : name;
    openSub = null;
  }
  function choose(it: Item) {
    closeAll();
    if (!it.disabled && it.run) it.run();
  }
  // Only prompt when actually switching; the confirm dialog warns about the reload.
  function requestLocale(loc: Locale) {
    if (getLocale() !== loc) pendingLocale = loc;
  }
  function confirmLocale() {
    const loc = pendingLocale;
    pendingLocale = null;
    if (loc) setLocale(loc); // reloads the app to apply the new locale
  }
</script>

<svelte:window onclick={closeAll} />

<div class="menubar">
  {#each menus as menu (menu.name)}
    <div class="slot">
      <button
        class="top"
        class:active={openMenu === menu.name}
        class:disabled={menu.disabled}
        disabled={menu.disabled}
        onclick={(e) => {
          e.stopPropagation();
          if (!menu.disabled) toggle(menu.name);
        }}>{menu.name}</button
      >
      {#if openMenu === menu.name && !menu.disabled}
        <div class="dropdown">
          {#each menu.items as it (it.label)}
            {#if it.children}
              <!-- Parent row: opens a flyout submenu on hover or click. -->
              <div
                class="parent"
                role="presentation"
                onmouseenter={() => (openSub = it.label)}
              >
                <button
                  class="item"
                  aria-haspopup="true"
                  aria-expanded={openSub === it.label}
                  onclick={(e) => {
                    e.stopPropagation();
                    openSub = openSub === it.label ? null : it.label;
                  }}
                >
                  <span>{it.label}</span><span class="arrow" aria-hidden="true">▸</span>
                </button>
                {#if openSub === it.label}
                  <div class="dropdown submenu">
                    {#each it.children as sub (sub.label)}
                      <button class="item" disabled={sub.disabled} onclick={() => choose(sub)}>
                        {#if sub.checked}✓ {/if}{sub.label}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <button
                class="item"
                disabled={it.disabled}
                onmouseenter={() => (openSub = null)}
                onclick={() => choose(it)}
              >
                {#if it.checked}✓ {/if}{it.label}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if pendingLocale}
  <ConfirmDialog
    title={m.menu_language_switch_title()}
    message={m.menu_language_switch_message({ language: LOCALE_NAMES[pendingLocale] })}
    confirmLabel={m.menu_language_switch_confirm()}
    onconfirm={confirmLocale}
    oncancel={() => (pendingLocale = null)}
  />
{/if}

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
  /* Submenu parent row + right-anchored flyout */
  .parent { position: relative; }
  .parent .item { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .arrow { color: #888; font-size: 10px; }
  .submenu { top: 0; left: 100%; }
</style>
