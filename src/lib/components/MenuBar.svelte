<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  import { type Locale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import { appLocale } from "../stores/locale.svelte";
  import { uiSize } from "../stores/uiSize.svelte";
  import { theme } from "../stores/theme.svelte";
  import { UI_SIZES, type UiSizeKey } from "../domain/uiSize";

  let {
    connected,
    onsession,
    onrefresh,
    onquit,
    onresetdefault,
  }: {
    connected: boolean;
    onsession: () => void;
    onrefresh: () => void;
    onquit: () => void;
    onresetdefault: () => void;
  } = $props();

  // An item is either a leaf (with `run`) or a parent that opens a submenu (`children`).
  type Item = { label: string; run?: () => void; disabled?: boolean; checked?: boolean; children?: Item[] };
  let openMenu = $state<string | null>(null);
  let openSub = $state<string | null>(null);

  const LOCALE_NAMES: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };

  const UI_SIZE_LABELS: Record<UiSizeKey, () => string> = {
    small: m.ui_size_small,
    default: m.ui_size_default,
    large: m.ui_size_large,
    larger: m.ui_size_larger,
  };

  const menus: { name: string; items: Item[]; disabled?: boolean }[] = $derived([
    {
      name: m.menu_file(),
      items: [
        { label: m.menu_session_manager(), run: onsession },
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
            { label: LOCALE_NAMES.en, checked: appLocale.current === "en", run: () => appLocale.set("en") },
            { label: LOCALE_NAMES.vi, checked: appLocale.current === "vi", run: () => appLocale.set("vi") },
          ],
        },
        {
          label: m.menu_ui_size(),
          children: UI_SIZES.map((s) => ({
            label: UI_SIZE_LABELS[s.key](),
            checked: uiSize.current === s.key,
            run: () => uiSize.set(s.key),
          })),
        },
        {
          label: m.menu_theme(),
          children: [
            { label: m.theme_light(), checked: theme.current === "latte", run: () => theme.set("latte") },
            { label: m.theme_dark(), checked: theme.current === "mocha", run: () => theme.set("mocha") },
          ],
        },
        { label: m.menu_reset_to_default(), run: onresetdefault },
      ],
    },
    { name: m.menu_query(), items: [{ label: m.menu_run_query(), disabled: true }] },
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

<style>
  .menubar {
    display: flex;
    align-items: center;
    height: 1.5rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 0 0.25rem;
    user-select: none;
    box-sizing: border-box;
  }
  .slot { position: relative; }
  .top {
    border: none;
    background: none;
    padding: 0.1875rem 0.5625rem;
    font-size: 0.75rem;
    color: var(--fg);
    border-radius: 0.125rem;
    cursor: pointer;
    line-height: 1;
  }
  .top:hover:not(.disabled):not(:disabled),
  .top.active:not(.disabled):not(:disabled) { background: var(--menu-hover); }
  .top.disabled,
  .top:disabled { color: var(--gray-aa); cursor: default; }
  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 30;
    min-width: 10rem;
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
    padding: 0.3125rem 0.75rem;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--fg);
  }
  .item:hover:not(:disabled) { background: var(--menu-hover); }
  .item:disabled { color: var(--gray-aa); cursor: default; }
  /* Submenu parent row + right-anchored flyout */
  .parent { position: relative; }
  .parent .item { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .arrow { color: var(--muted); font-size: 0.625rem; }
  .submenu { top: 0; left: 100%; }
</style>
