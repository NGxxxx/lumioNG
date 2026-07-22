<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  import { type Locale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import { appLocale } from "../stores/locale.svelte";
  import { uiSize } from "../stores/uiSize.svelte";
  import { theme } from "../stores/theme.svelte";
  import { collectionSort } from "../stores/collectionSort.svelte";
  import { settings } from "../stores/settings.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { UI_SIZES, type UiSizeKey } from "../domain/uiSize";
  import type { CollectionSortMode } from "../domain/namespaces";
  import type { ContextKind } from "../stores/navigation.svelte";
  import { SHORTCUTS, type Command, type CommandId } from "../domain/commands";
  import { formatCombo } from "../domain/shortcuts";
  import { detectPlatform } from "../stores/platform";

  let {
    commands,
    contextTabs,
    activeContextKind,
    onshowcontext,
  }: {
    commands: Partial<Record<CommandId, Command>>;
    contextTabs: { kind: ContextKind; label: string }[];
    activeContextKind: ContextKind | null;
    onshowcontext: (kind: ContextKind) => void;
  } = $props();

  // An item is either a leaf (with `run`) or a parent that opens a submenu (`children`).
  type Item = { label: string; shortcut?: string; run?: () => void; disabled?: boolean; checked?: boolean; children?: Item[] };
  let openMenu = $state<string | null>(null);
  let openSub = $state<string | null>(null);
  let openSubSub = $state<string | null>(null);

  const plat = detectPlatform();

  /** Looks up a registry command's shortcut hint (if any), formatted for the current platform. */
  function shortcutOf(id: CommandId): string | undefined {
    const combo = SHORTCUTS[id];
    return combo ? formatCombo(combo, plat) : undefined;
  }

  /** Builds a leaf menu item from a registry command id, with its shortcut hint (if any). */
  function cmdItem(id: CommandId, label: string): Item {
    const c = commands[id];
    return {
      label,
      shortcut: shortcutOf(id),
      run: c?.run,
      disabled: !c || c.disabled,
    };
  }

  /** Maps a "Go to" context tab to its registry command id, so its menu item can pick up the Mod+1..4 shortcut hint. */
  const GOTO_CMD: Record<ContextKind, CommandId> = {
    host: "goto.host",
    database: "goto.database",
    collection: "goto.collection",
    data: "goto.data",
  };

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
        cmdItem("file.sessionManager", m.menu_session_manager()),
        cmdItem("file.refresh", m.menu_refresh()),
        cmdItem("file.newQuery", m.tab_bar_new_query()),
        cmdItem("file.newDocument", m.menu_new_document()),
        cmdItem("file.import", m.menu_import()),
        cmdItem("file.export", m.menu_export()),
        cmdItem("file.quit", m.menu_quit()),
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
          label: m.menu_database(),
          children: [
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
            {
              label: m.menu_show_system_databases(),
              checked: settings.showSystemDatabases,
              run: () => {
                settings.setShowSystemDatabases(!settings.showSystemDatabases);
                for (const s of sessionManager.sessions) s.tree.refresh();
              },
            },
          ],
        },
        cmdItem("view.resetToDefault", m.menu_reset_to_default()),
      ],
    },
    {
      name: m.menu_query(),
      items: [
        cmdItem("query.run", m.menu_run_query()),
        cmdItem("query.runSelection", m.menu_run_selection()),
        cmdItem("query.stop", m.menu_stop()),
        cmdItem("query.explain", m.menu_explain()),
        cmdItem("query.aggregate", m.menu_aggregate()),
        cmdItem("query.save", m.menu_save_query()),
      ],
    },
    {
      name: m.menu_go_to(),
      items: [
        ...contextTabs.map((c) => ({
          label: c.label,
          shortcut: shortcutOf(GOTO_CMD[c.kind]),
          checked: activeContextKind === c.kind,
          run: () => onshowcontext(c.kind),
        })),
        cmdItem("goto.nextTab", m.menu_next_tab()),
        cmdItem("goto.prevTab", m.menu_previous_tab()),
      ],
      disabled: contextTabs.length === 0 && (commands["goto.nextTab"]?.disabled ?? true) && (commands["goto.prevTab"]?.disabled ?? true),
    },
    { name: m.menu_help(), items: [cmdItem("help.about", m.menu_about())] },
  ]);

  function closeAll() {
    openMenu = null;
    openSub = null;
    openSubSub = null;
  }
  function toggle(name: string) {
    openMenu = openMenu === name ? null : name;
    openSub = null;
    openSubSub = null;
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
                onmouseenter={() => { if (openSub !== it.label) { openSub = it.label; openSubSub = null; } }}
              >
                <button
                  class="item"
                  aria-haspopup="true"
                  aria-expanded={openSub === it.label}
                  onclick={(e) => {
                    e.stopPropagation();
                    openSub = openSub === it.label ? null : it.label;
                    openSubSub = null;
                  }}
                >
                  <span>{it.label}</span><span class="arrow" aria-hidden="true">▸</span>
                </button>
                {#if openSub === it.label}
                  <div class="dropdown submenu">
                    {#each it.children as sub (sub.label)}
                      {#if sub.children}
                        <div
                          class="parent"
                          role="presentation"
                          onmouseenter={() => (openSubSub = sub.label)}
                        >
                          <button
                            class="item"
                            aria-haspopup="true"
                            aria-expanded={openSubSub === sub.label}
                            onclick={(e) => {
                              e.stopPropagation();
                              openSubSub = openSubSub === sub.label ? null : sub.label;
                            }}
                          >
                            <span>{sub.label}</span><span class="arrow" aria-hidden="true">▸</span>
                          </button>
                          {#if openSubSub === sub.label}
                            <div class="dropdown submenu">
                              {#each sub.children as leaf (leaf.label)}
                                <button class="item" disabled={leaf.disabled} onclick={() => choose(leaf)}>
                                  <span>{#if leaf.checked}✓ {/if}{leaf.label}</span>
                                </button>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {:else}
                        <button
                          class="item"
                          disabled={sub.disabled}
                          onmouseenter={() => (openSubSub = null)}
                          onclick={() => choose(sub)}
                        >
                          <span>{#if sub.checked}✓ {/if}{sub.label}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <button
                class="item"
                disabled={it.disabled}
                onmouseenter={() => { openSub = null; openSubSub = null; }}
                onclick={() => choose(it)}
              >
                <span>{#if it.checked}✓ {/if}{it.label}</span>
                {#if it.shortcut}<span class="shortcut">{it.shortcut}</span>{/if}
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
    font-size: var(--fs);
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
    width: max-content;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: 0 2px 6px rgba(0,0,0,.15);
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 0.3125rem 0.75rem;
    cursor: pointer;
    font-size: var(--fs);
    color: var(--fg);
    white-space: nowrap;
  }
  .item:hover:not(:disabled) { background: var(--menu-hover); }
  .item:disabled { color: var(--gray-aa); cursor: default; }
  .shortcut { color: var(--muted); font-size: 0.6875rem; flex: none; }
  /* Submenu parent row + right-anchored flyout */
  .parent { position: relative; }
  .arrow { color: var(--muted); font-size: 0.625rem; }
  .submenu { top: 0; left: 100%; }
</style>
