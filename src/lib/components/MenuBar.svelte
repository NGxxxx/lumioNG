<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  import { type Locale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import { appLocale } from "../stores/locale.svelte";
  import { uiSize } from "../stores/uiSize.svelte";
  import { theme } from "../stores/theme.svelte";
  import { collectionSort } from "../stores/collectionSort.svelte";
  import { UI_SIZES, type UiSizeKey } from "../domain/uiSize";
  import type { CollectionSortMode } from "../domain/namespaces";
  import type { ContextKind } from "../stores/navigation.svelte";
  import AboutDialog from "./AboutDialog.svelte";

  let {
    connected,
    onsession,
    onrefresh,
    onquit,
    onresetdefault,
    onnewquery,
    canNewDoc,
    onnewdocument,
    canImport,
    onimport,
    canExport,
    onexport,
    canRun,
    onrun,
    canRunSelection,
    onrunselection,
    canStop,
    onstop,
    canExplainQuery,
    onexplainquery,
    canAggregate,
    onaggregate,
    canSaveQuery,
    onsavequery,
    contextTabs,
    activeContextKind,
    onshowcontext,
    canNextTab,
    onnexttab,
    canPrevTab,
    onprevtab,
  }: {
    connected: boolean;
    onsession: () => void;
    onrefresh: () => void;
    onquit: () => void;
    onresetdefault: () => void;
    onnewquery: () => void;
    canNewDoc: boolean;
    onnewdocument: () => void;
    canImport: boolean;
    onimport: () => void;
    canExport: boolean;
    onexport: () => void;
    canRun: boolean;
    onrun: () => void;
    canRunSelection: boolean;
    onrunselection: () => void;
    canStop: boolean;
    onstop: () => void;
    canExplainQuery: boolean;
    onexplainquery: () => void;
    canAggregate: boolean;
    onaggregate: () => void;
    canSaveQuery: boolean;
    onsavequery: () => void;
    contextTabs: { kind: ContextKind; label: string }[];
    activeContextKind: ContextKind | null;
    onshowcontext: (kind: ContextKind) => void;
    canNextTab: boolean;
    onnexttab: () => void;
    canPrevTab: boolean;
    onprevtab: () => void;
  } = $props();

  let aboutOpen = $state(false);

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
        { label: m.tab_bar_new_query(), run: onnewquery, disabled: !connected },
        { label: m.menu_new_document(), run: onnewdocument, disabled: !canNewDoc },
        { label: m.menu_import(), run: onimport, disabled: !canImport },
        { label: m.menu_export(), run: onexport, disabled: !canExport },
        { label: m.menu_quit(), run: onquit },
      ],
    },
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
        {
          label: m.menu_sort_collections(),
          children: (
            [
              ["default", m.sort_mode_default()],
              ["asc", m.sort_mode_asc()],
              ["desc", m.sort_mode_desc()],
            ] as [CollectionSortMode, string][]
          ).map(([mode, label]) => ({
            label,
            checked: collectionSort.current === mode,
            run: () => collectionSort.set(mode),
          })),
        },
        { label: m.menu_reset_to_default(), run: onresetdefault },
      ],
    },
    {
      name: m.menu_query(),
      items: [
        { label: m.menu_run_query(), run: onrun, disabled: !canRun },
        { label: m.menu_run_selection(), run: onrunselection, disabled: !canRunSelection },
        { label: m.menu_stop(), run: onstop, disabled: !canStop },
        { label: m.menu_explain(), run: onexplainquery, disabled: !canExplainQuery },
        { label: m.menu_aggregate(), run: onaggregate, disabled: !canAggregate },
        { label: m.menu_save_query(), run: onsavequery, disabled: !canSaveQuery },
      ],
    },
    {
      name: m.menu_go_to(),
      items: [
        ...contextTabs.map((c) => ({
          label: c.label,
          checked: activeContextKind === c.kind,
          run: () => onshowcontext(c.kind),
        })),
        { label: m.menu_next_tab(), run: onnexttab, disabled: !canNextTab },
        { label: m.menu_previous_tab(), run: onprevtab, disabled: !canPrevTab },
      ],
      disabled: contextTabs.length === 0 && !canNextTab && !canPrevTab,
    },
    { name: m.menu_help(), items: [{ label: m.menu_about(), run: () => (aboutOpen = true) }] },
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

{#if aboutOpen}
  <AboutDialog onclose={() => (aboutOpen = false)} />
{/if}

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
