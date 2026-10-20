<script lang="ts">
  import { sessionManager } from "#lib/stores/sessionManager.svelte.js";
  import { shell } from "#lib/stores/shell.svelte.js";
  import { queryLibrary } from "#lib/stores/queryLibrary.svelte.js";
  import { windowControls } from "#lib/stores/desktop.js";
  import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import SaveQueryDialog from "#lib/components/SaveQueryDialog.svelte";
  import CommandPalette from "#lib/components/CommandPalette.svelte";
  import ShortcutsDialog from "#lib/components/ShortcutsDialog.svelte";
  import AboutDialog from "#lib/components/AboutDialog.svelte";
  import CrashReportDialog from "#lib/components/CrashReportDialog.svelte";
  import McpDialog from "#lib/components/McpDialog.svelte";
  import ToastHost from "#lib/components/ToastHost.svelte";
  import { namespacePaletteItems, parseNamespaceId, parseRecentCollectionId, recentPaletteItems, type PaletteItem } from "#lib/domain/palette.js";
  import { queryHistory } from "#lib/stores/queryHistory.svelte.js";
  import { recentCollections } from "#lib/stores/recentCollections.svelte.js";
  import { settings } from "#lib/stores/settings.svelte.js";
  import { theme } from "#lib/stores/theme.svelte.js";
  import { mcp } from "#lib/stores/mcp.svelte.js";
  import { undo } from "#lib/stores/undo.svelte.js";
  import { jobs } from "#lib/stores/jobs.svelte.js";
  import { pendingEdits } from "#lib/stores/pendingEdits.svelte.js";
  import { msgCount } from "#lib/msgkey.js";
  import type { SavedQuery } from "#lib/domain/queryTree.js";
  import type { Command, CommandId } from "#lib/domain/commands.js";
  import type { Platform } from "#lib/domain/shortcuts.js";
  import type { AppContext } from "#lib/stores/appContext.svelte.js";

  const { quit } = windowControls;

  let {
    app,
    commands,
    plat,
    shortcutHint,
  }: {
    app: AppContext;
    commands: Partial<Record<CommandId, Command>>;
    plat: Platform;
    shortcutHint: (id: CommandId) => string | undefined;
  } = $props();

  const sm = sessionManager;
  const sel = $derived(app.sel);

  // ── Command palette: every registry command + view toggles + saved queries + namespaces ──

  const PALETTE_COMMANDS: [CommandId, () => string, "actions" | "query" | "navigate" | "view"][] = [
    ["file.newQuery", m.tab_bar_new_query, "actions"],
    ["file.newDocument", m.menu_new_document, "actions"],
    ["file.refresh", m.menu_refresh, "actions"],
    ["file.import", m.menu_import, "actions"],
    ["file.export", m.menu_export, "actions"],
    ["file.sessionManager", m.menu_session_manager, "actions"],
    ["query.run", m.menu_run_query, "query"],
    ["query.runSelection", m.menu_run_selection, "query"],
    ["query.stop", m.menu_stop, "query"],
    ["query.explain", m.menu_explain, "query"],
    ["query.aggregate", m.menu_aggregate, "query"],
    ["query.watch", m.menu_watch_changes, "query"],
    ["query.save", m.menu_save_query, "query"],
    ["goto.host", m.nav_overview, "navigate"],
    ["goto.database", m.palette_group_databases, "navigate"],
    ["goto.data", m.view_data, "navigate"],
    ["goto.schema", m.view_schema, "navigate"],
    ["goto.nextTab", m.menu_next_tab, "navigate"],
    ["goto.prevTab", m.menu_previous_tab, "navigate"],
    ["view.resetToDefault", m.menu_reset_to_default, "view"],
    ["edit.undo", m.undo_last, "actions"],
    ["query.history", m.cmd_query_history, "query"],
    ["help.shortcuts", m.menu_keyboard_shortcuts, "view"],
    ["help.about", m.menu_about, "view"],
    ["help.exportDiagnostics", m.menu_export_diagnostics, "actions"],
    ["tools.mcpSettings", m.menu_mcp_settings, "actions"],
    ["tools.exportSettings", m.menu_export_settings, "actions"],
    ["tools.importSettings", m.menu_import_settings, "actions"],
    ["file.quit", m.menu_quit, "view"],
  ];

  const VIEW_TOGGLES: Record<string, { label: () => string; run: () => void }> = {
    "toggle:theme": { label: m.palette_toggle_theme, run: () => theme.set(theme.current === "mocha" ? "latte" : "mocha") },
    "toggle:wrap": { label: m.palette_toggle_wrap, run: () => commands["view.toggleWrap"]?.run() },
    "toggle:log": { label: m.palette_toggle_log, run: () => commands["view.toggleLog"]?.run() },
    "toggle:saved": { label: m.palette_toggle_saved, run: () => commands["view.toggleSavedQueries"]?.run() },
    "toggle:stageEdits": { label: m.menu_stage_edits, run: () => settings.setStageCellEdits(!settings.stageCellEdits) },
    "toggle:mcp": { label: m.palette_toggle_mcp, run: () => mcp.toggle() },
    "density:compact": { label: () => `${m.menu_density()}: ${m.density_compact()}`, run: () => settings.setDensity("compact") },
    "density:comfortable": { label: () => `${m.menu_density()}: ${m.density_comfortable()}`, run: () => settings.setDensity("comfortable") },
    "density:spacious": { label: () => `${m.menu_density()}: ${m.density_spacious()}`, run: () => settings.setDensity("spacious") },
    "view:indexes": { label: m.view_indexes, run: () => { if (sel?.coll) app.showCollectionView("indexes"); } },
    "view:info": { label: m.view_info, run: () => { if (sel?.coll) app.showCollectionView("info"); } },
  };

  const paletteItems = $derived.by((): PaletteItem[] => {
    if (!app.paletteOpen) return [];
    const group = {
      actions: m.palette_group_actions(),
      query: m.palette_group_query(),
      navigate: m.palette_group_navigate(),
      view: m.palette_group_view(),
    };
    const cmds: PaletteItem[] = PALETTE_COMMANDS.map(([id, label, g]) => ({
      id,
      group: group[g],
      label: label(),
      shortcut: shortcutHint(id),
      disabled: commands[id]?.disabled ?? true,
    }));
    const toggles: PaletteItem[] = Object.entries(VIEW_TOGGLES).map(([id, t]) => ({ id, group: group.view, label: t.label() }));
    const saved: PaletteItem[] = sm.activeId
      ? queryLibrary.nodes
          .filter((n): n is SavedQuery => n.kind === "query")
          .map((q) => ({ id: `saved:${q.id}`, group: m.palette_group_saved(), label: q.name, detail: q.db ?? undefined }))
      : [];
    const ns = namespacePaletteItems(app.tree?.databases ?? [], {
      databases: m.palette_group_databases(),
      collections: m.palette_group_collections(),
    });
    // Namespaces first: jumping to a collection is the most common reason to open the palette.
    const recent = recentPaletteItems(queryHistory.entries, recentCollections.list).map((it) => ({ ...it, group: m.palette_group_recent() }));
    return [...recent, ...ns, ...cmds, ...saved, ...toggles];
  });

  const paletteContext = $derived(
    [shell.connection?.label, sel ? (sel.coll ? `${sel.db}.${sel.coll}` : sel.db) : null].filter((x): x is string => !!x),
  );

  function runPaletteItem(id: string) {
    if (id.startsWith("recent:q:")) {
      const e = queryHistory.entries.find((x) => `recent:q:${x.id}` === id);
      if (e) app.openHistoryEntry(e);
      return;
    }
    const recentColl = parseRecentCollectionId(id);
    if (recentColl) {
      app.nav?.selectCollection(recentColl.db, recentColl.coll);
      sm.showDestination();
      return;
    }
    const target = parseNamespaceId(id);
    if (target) {
      if (target.coll) app.nav?.selectCollection(target.db, target.coll);
      else app.nav?.selectDatabase(target.db);
      return;
    }
    if (id.startsWith("saved:")) {
      const q = queryLibrary.nodes.find((n): n is SavedQuery => n.kind === "query" && `saved:${n.id}` === id);
      if (q) app.openSavedQuery(q);
      return;
    }
    if (id in VIEW_TOGGLES) {
      VIEW_TOGGLES[id].run();
      return;
    }
    const c = commands[id as CommandId];
    if (c && !c.disabled) c.run();
  }
</script>

{#if app.confirmQuit}
  <ConfirmDialog
    title={m.page_quit_title()}
    message={[
      m.page_quit_message(),
      jobs.running > 0 ? m.jobs_running_warning({ count: String(jobs.running) }) : "",
      pendingEdits.count() > 0 ? msgCount("pending_quit_warning", pendingEdits.count()) : "",
    ].filter(Boolean).join(" ")}
    confirmLabel={m.page_quit_confirm()}
    cancelLabel={m.page_quit_cancel()}
    danger
    onconfirm={quit}
    oncancel={() => (app.confirmQuit = false)}
  />
{/if}
{#if app.saveQueryDialog}
  <SaveQueryDialog onsubmit={app.submitSaveQuery} oncancel={() => (app.saveQueryDialog = null)} />
{/if}
{#if app.confirmReset}
  <ConfirmDialog
    title={m.page_reset_default_title()}
    message={m.page_reset_default_message()}
    confirmLabel={m.page_reset_default_confirm()}
    danger
    onconfirm={app.doReset}
    oncancel={() => (app.confirmReset = false)}
  />
{/if}
<CrashReportDialog />
{#if app.aboutOpen}
  <AboutDialog onclose={() => (app.aboutOpen = false)} />
{/if}
{#if app.mcpOpen}
  <McpDialog onclose={() => (app.mcpOpen = false)} />
{/if}
{#if app.shortcutsOpen}
  <ShortcutsDialog platform={plat} onclose={() => (app.shortcutsOpen = false)} />
{/if}
{#if app.paletteOpen}
  <CommandPalette
    items={paletteItems}
    context={paletteContext}
    onrun={runPaletteItem}
    onclose={() => (app.paletteOpen = false)}
  />
{/if}
<ToastHost />
{#if undo.conflict}
  <ConfirmDialog
    title={m.undo_conflict_title()}
    message={m.undo_conflict_message()}
    confirmLabel={m.undo_overwrite()}
    danger
    onconfirm={() => undo.confirmOverwrite()}
    oncancel={() => undo.cancelOverwrite()}
  />
{/if}
