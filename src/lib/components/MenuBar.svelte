<!-- src/lib/components/MenuBar.svelte -->
<script lang="ts">
  import { type Locale } from "#lib/paraglide/runtime.js";
  import * as m from "#lib/paraglide/messages.js";
  import { appLocale } from "../stores/locale.svelte";
  import { uiSize } from "../stores/uiSize.svelte";
  import { theme, type ThemeKey } from "../stores/theme.svelte";
  import { collectionSort } from "../stores/collectionSort.svelte";
  import { settings, type Density } from "../stores/settings.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { UI_SIZES, type UiSizeKey } from "../domain/uiSize";
  import type { CollectionSortMode } from "../domain/namespaces";
  import { SHORTCUTS, type Command, type CommandId } from "../domain/commands";
  import { formatCombo } from "../domain/shortcuts";
  import { detectPlatform } from "../stores/platform";
  import { mcp } from "../stores/mcp.svelte";

  let {
    commands,
    goto,
  }: {
    commands: Partial<Record<CommandId, Command>>;
    /** "Go to" destinations (Host, Database, Data, Schema, Indexes, Info), built by the page. */
    goto: { label: string; checked: boolean; disabled?: boolean; shortcut?: string; run: () => void }[];
  } = $props();

  /** A row of a menu: a leaf (`run`), a parent opening a submenu (`children`), a section `header`,
   *  or a `separator`. `toggle` marks an on/off setting (✓ when `checked`); `checked` alone marks the
   *  current choice of a radio-style submenu. `value` shows a parent's current choice on its row, so
   *  every setting reads the same way: name on the left, state on the right. */
  type Item = {
    label: string;
    kind?: "header" | "separator";
    shortcut?: string;
    value?: string;
    run?: () => void;
    disabled?: boolean;
    checked?: boolean;
    toggle?: boolean;
    children?: Item[];
  };
  let openMenu = $state<string | null>(null);
  let openSub = $state<string | null>(null);

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

  const header = (label: string): Item => ({ label, kind: "header" });
  let sepSeq = 0;
  const separator = (): Item => ({ label: `—${sepSeq++}`, kind: "separator" });

  /** A radio-style setting: a parent row showing the current choice, its options in a submenu. */
  function choice<T>(label: string, options: [T, string][], current: T, set: (v: T) => void): Item {
    return {
      label,
      value: options.find(([v]) => v === current)?.[1],
      children: options.map(([v, text]) => ({ label: text, checked: v === current, run: () => set(v) })),
    };
  }

  const toggleItem = (label: string, on: boolean, set: (v: boolean) => void): Item => ({ label, toggle: true, checked: on, run: () => set(!on) });

  const LOCALE_NAMES: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };

  const UI_SIZE_LABELS: Record<UiSizeKey, () => string> = {
    small: m.ui_size_small,
    default: m.ui_size_default,
    large: m.ui_size_large,
    larger: m.ui_size_larger,
  };

  const mcpValue = $derived(
    mcp.status === "running" ? `:${mcp.port}` : mcp.status === "starting" ? "…" : mcp.status === "error" ? m.mcp_status_error() : undefined,
  );

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
      items: [
        header(m.menu_section_appearance()),
        choice(m.menu_theme(), [["latte", m.theme_light()], ["mocha", m.theme_dark()]] as [ThemeKey, string][], theme.current, (k) => theme.set(k)),
        choice(m.menu_ui_size(), UI_SIZES.map((s) => [s.key, UI_SIZE_LABELS[s.key]()] as [UiSizeKey, string]), uiSize.current, (k) => uiSize.set(k)),
        choice(
          m.menu_density(),
          [["compact", m.density_compact()], ["comfortable", m.density_comfortable()], ["spacious", m.density_spacious()]] as [Density, string][],
          settings.density,
          (d) => settings.setDensity(d),
        ),
        choice(m.menu_language(), (["en", "vi"] as Locale[]).map((l) => [l, LOCALE_NAMES[l]] as [Locale, string]), appLocale.current, (l) => appLocale.set(l)),
        separator(),
        header(m.menu_section_navigator()),
        choice(
          m.menu_sort_collections(),
          [["default", m.sort_mode_default()], ["asc", m.sort_mode_asc()], ["desc", m.sort_mode_desc()]] as [CollectionSortMode, string][],
          collectionSort.current,
          (mode) => collectionSort.set(mode),
        ),
        toggleItem(m.menu_show_system_databases(), settings.showSystemDatabases, (v) => {
          settings.setShowSystemDatabases(v);
          for (const s of sessionManager.sessions) s.tree.refresh();
        }),
        separator(),
        header(m.menu_section_editing()),
        toggleItem(m.menu_stage_edits(), settings.stageCellEdits, (v) => settings.setStageCellEdits(v)),
        toggleItem(m.menu_wrap_long_lines(), settings.wrapLongLines, (v) => settings.setWrapLongLines(v)),
        separator(),
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
        cmdItem("query.watch", m.menu_watch_changes()),
        cmdItem("query.save", m.menu_save_query()),
      ],
    },
    {
      name: m.menu_go_to(),
      items: [
        ...goto.map((g) => ({ label: g.label, shortcut: g.shortcut, checked: g.checked, disabled: g.disabled, run: g.run })),
        cmdItem("goto.nextTab", m.menu_next_tab()),
        cmdItem("goto.prevTab", m.menu_previous_tab()),
      ],
      disabled: goto.length === 0 && (commands["goto.nextTab"]?.disabled ?? true) && (commands["goto.prevTab"]?.disabled ?? true),
    },
    {
      name: m.menu_tools(),
      items: [
        { ...toggleItem(m.menu_mcp_server(), mcp.enabled, (v) => mcp.setEnabled(v)), value: mcpValue },
        cmdItem("tools.mcpSettings", m.menu_mcp_settings()),
        cmdItem("tools.auditLog", m.menu_audit_log()),
        cmdItem("tools.exportSettings", m.menu_export_settings()),
        cmdItem("tools.importSettings", m.menu_import_settings()),
      ],
    },
    { name: m.menu_help(), items: [cmdItem("help.shortcuts", m.menu_keyboard_shortcuts()), cmdItem("help.about", m.menu_about()), cmdItem("help.exportDiagnostics", m.menu_export_diagnostics())] },
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
    // A toggle keeps the menu open so several settings can be flipped in one go.
    if (!it.toggle) closeAll();
    if (!it.disabled && it.run) it.run();
  }
</script>

<svelte:window onclick={closeAll} />

{#snippet leaf(it: Item, inSub: boolean)}
  <button
    class="item"
    role={it.toggle ? "menuitemcheckbox" : undefined}
    aria-checked={it.toggle ? it.checked === true : undefined}
    disabled={it.disabled}
    onmouseenter={() => { if (!inSub) openSub = null; }}
    onclick={(e) => { if (it.toggle) e.stopPropagation(); choose(it); }}
  >
    <span class="mark" aria-hidden="true">{it.checked ? "✓" : ""}</span>
    <span class="label">{it.label}</span>
    {#if it.value}<span class="value">{it.value}</span>{/if}
    {#if it.shortcut}<span class="shortcut">{it.shortcut}</span>{/if}
  </button>
{/snippet}

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
            {#if it.kind === "separator"}
              <div class="sep" role="separator"></div>
            {:else if it.kind === "header"}
              <div class="header" role="presentation">{it.label}</div>
            {:else if it.children}
              <!-- Parent row: opens a flyout submenu on hover or click; shows the current choice. -->
              <div
                class="parent"
                role="presentation"
                onmouseenter={() => (openSub = it.label)}
              >
                <button
                  class="item"
                  class:open={openSub === it.label}
                  aria-haspopup="true"
                  aria-expanded={openSub === it.label}
                  onclick={(e) => {
                    e.stopPropagation();
                    openSub = openSub === it.label ? null : it.label;
                  }}
                >
                  <span class="mark" aria-hidden="true"></span>
                  <span class="label">{it.label}</span>
                  {#if it.value}<span class="value">{it.value}</span>{/if}
                  <span class="arrow" aria-hidden="true">▸</span>
                </button>
                {#if openSub === it.label}
                  <div class="dropdown submenu">
                    {#each it.children as sub (sub.label)}
                      {@render leaf(sub, true)}
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              {@render leaf(it, false)}
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* Rendered inline in the title bar row: no own background or border. */
  .menubar {
    display: flex;
    align-items: center;
    gap: 0.0625rem;
    user-select: none;
    box-sizing: border-box;
  }
  .slot { position: relative; }
  .top {
    border: none;
    background: none;
    padding: 0.3125rem 0.5rem;
    font-size: 0.78125rem;
    color: var(--c-subtext1);
    border-radius: var(--radius);
    cursor: pointer;
    line-height: 1;
  }
  .top:hover:not(.disabled):not(:disabled),
  .top.active:not(.disabled):not(:disabled) { background: var(--menu-hover); color: var(--fg); }
  .top.disabled,
  .top:disabled { color: var(--gray-aa); cursor: default; }
  .dropdown {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    z-index: 30;
    min-width: 12rem;
    width: max-content;
    background: var(--popover);
    border: 1px solid var(--c-surface1);
    border-radius: var(--radius-lg);
    padding: 0.25rem;
    box-shadow: var(--shadow-sm);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    height: 1.875rem;
    padding: 0 0.625rem 0 0.375rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--fs);
    color: var(--c-subtext1);
    white-space: nowrap;
  }
  .item:hover:not(:disabled),
  .item.open { background: var(--menu-hover); color: var(--fg); }
  .item:disabled { color: var(--gray-aa); cursor: default; }
  /* Fixed gutter so labels line up whether or not a row carries a check mark. */
  .mark { width: 0.875rem; flex: none; text-align: center; color: var(--accent); font-size: 0.75rem; }
  .label { flex: 1; }
  .value { color: var(--muted); font-size: 0.71875rem; margin-left: 1rem; }
  .shortcut { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; flex: none; margin-left: 1rem; }
  .header {
    padding: 0.375rem 0.625rem 0.125rem 1.75rem;
    font-size: 0.65625rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .sep { height: 1px; margin: 0.25rem 0.375rem; background: var(--border); }
  /* Submenu parent row + right-anchored flyout */
  .parent { position: relative; }
  .arrow { color: var(--muted); font-size: 0.625rem; flex: none; }
  .submenu { top: -0.3125rem; left: calc(100% + 0.25rem); min-width: 10rem; }
</style>
