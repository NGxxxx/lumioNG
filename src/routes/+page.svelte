<script lang="ts">
  import { onMount } from "svelte";
  import { aggregateTemplate } from "#lib/domain/queryStatement.js";
  import { cancelScript } from "#lib/stores/queryRuns.svelte.js";
  import { sessionManager } from "#lib/stores/sessionManager.svelte.js";
  import { shell } from "#lib/stores/shell.svelte.js";
  import { queryLibrary } from "#lib/stores/queryLibrary.svelte.js";
  import { activeDataView } from "#lib/stores/activeDataView.svelte.js";
  import { activeDocumentForm } from "#lib/stores/activeDocumentForm.svelte.js";
  import { createAppContext } from "#lib/stores/appContext.svelte.js";
  import { formatCombo } from "#lib/domain/shortcuts.js";
  import { settings } from "#lib/stores/settings.svelte.js";
  import { mcp } from "#lib/stores/mcp.svelte.js";
  import { undo } from "#lib/stores/undo.svelte.js";
  import { SHORTCUTS, type Command, type CommandId } from "#lib/domain/commands.js";
  import { detectPlatform } from "#lib/stores/platform.js";
  import AppShell from "#lib/components/AppShell.svelte";
  import AppDialogs from "#lib/components/AppDialogs.svelte";
  import GlobalShortcuts from "#lib/components/GlobalShortcuts.svelte";

  const sm = sessionManager;
  const app = createAppContext();
  const sel = $derived(app.sel);
  const nav = $derived(app.nav);
  const page = $derived(app.page);
  const active = $derived(app.active);
  const dataViewActive = $derived(app.dataViewActive);

  onMount(() => {
    queryLibrary.load(); // once at app start; failure shows in the panel and never blocks the app
    mcp.init(); // brings the MCP server back if it was on last time
  });

  const plat = detectPlatform();
  const shortcutHint = (id: CommandId) => (SHORTCUTS[id] ? formatCombo(SHORTCUTS[id]!, plat) : undefined);

  const commands: Partial<Record<CommandId, Command>> = $derived({
    "file.sessionManager": { disabled: false, run: () => shell.toggleSession() },
    "file.refresh": { disabled: shell.connection === null, run: app.doRefresh },
    "file.newQuery": { disabled: shell.connection === null, run: () => sm.openQuery(aggregateTemplate("")) },
    "file.newDocument": { disabled: !(sel?.coll != null && !app.readOnly), run: app.newDocActive },
    "file.import": {
      disabled: !(sel?.db != null && !app.readOnly),
      run: () => { if (sel?.db && sm.activeId) app.namespacePanelRef?.startImport(sm.activeId, sel.db, sel.coll); },
    },
    "file.export": {
      disabled: !(app.canUseDataView ? (activeDataView.handle?.canExport ?? false) : false),
      run: () => (app.canUseDataView ? activeDataView.handle?.exportCurrent() : undefined),
    },
    "file.quit": { disabled: false, run: () => (app.confirmQuit = true) },
    "query.run": { disabled: app.activeQueryRun == null, run: () => app.activeQueryRun?.run(sel?.db ?? null, app.activeQueryTab?.sessionId) },
    "query.runSelection": { disabled: !(app.activeQueryRun?.hasSelection ?? false), run: () => app.activeQueryRun?.runSelection(sel?.db ?? null, app.activeQueryTab?.sessionId) },
    "query.stop": { disabled: !(app.activeQueryRun?.running ?? false), run: () => { if (sm.activeId) cancelScript(sm.activeId); } },
    "query.explain": { disabled: app.activeQueryRun == null, run: () => app.activeQueryRun?.explainAfterRun(sel?.db ?? null, app.activeQueryTab?.sessionId) },
    "query.aggregate": { disabled: !(sel?.coll != null), run: () => { if (sel?.coll) sm.openQuery(aggregateTemplate(sel.coll)); } },
    // Watches what the destination tab shows: the collection, the database, or the whole deployment.
    "query.watch": {
      disabled: shell.connection === null,
      run: () => sm.openWatch({ db: page === "host" ? null : (sel?.db ?? null), coll: page === "collection" ? (sel?.coll ?? null) : null, idText: null }),
    },
    "query.save": {
      disabled: !(app.activeQueryTab ? !queryLibrary.blocked : (activeDocumentForm.handle?.canSave ?? false)),
      run: () => (app.activeQueryTab ? app.saveActiveQuery() : activeDocumentForm.handle?.save()),
    },
    "goto.nextTab": { disabled: !(sm.workTabs.length > 1), run: () => app.cycleWorkTab(1) },
    "goto.prevTab": { disabled: !(sm.workTabs.length > 1), run: () => app.cycleWorkTab(-1) },
    "view.closeWorkTab": {
      disabled: active?.zone !== "work",
      run: () => { if (active?.zone === "work") sm.closeWork(active.id); },
    },
    "goto.host": { disabled: page === null, run: () => { nav?.selectHost(); sm.showDestination(); } },
    "goto.database": { disabled: !sel, run: () => { if (sel) { nav?.selectDatabase(sel.db); sm.showDestination(); } } },
    "goto.data": { disabled: !sel?.coll, run: () => app.showCollectionView("data") },
    "goto.schema": { disabled: !sel?.coll, run: () => app.showCollectionView("schema") },
    "view.toggleLog": { disabled: false, run: () => (activeDataView.handle?.toggleLog ? activeDataView.handle.toggleLog() : shell.toggleLog()) },
    "view.toggleWrap": { disabled: false, run: () => settings.setWrapLongLines(!settings.wrapLongLines) },
    "view.toggleSavedQueries": { disabled: false, run: () => shell.toggleSavedQueries() },
    "view.resetToDefault": { disabled: false, run: () => (app.confirmReset = true) },
    "view.resetLayout": { disabled: !dataViewActive, run: () => activeDataView.handle?.resetLayout?.() },
    "help.about": { disabled: false, run: () => (app.aboutOpen = true) },
    "help.exportDiagnostics": { disabled: false, run: () => void app.exportDiagnosticsBundle() },
    "tools.mcpSettings": { disabled: false, run: () => (app.mcpOpen = true) },
    "tools.exportSettings": { disabled: false, run: () => void app.exportSettings() },
    "tools.importSettings": { disabled: false, run: () => void app.importSettings() },
    "query.history": { disabled: !app.activeQueryRun, run: () => app.activeQueryRun?.toggleHistory() },
    "edit.undo": { disabled: undo.entries.length === 0 || undo.busy, run: () => void undo.undoLast() },
    "help.shortcuts": { disabled: false, run: () => (app.shortcutsOpen = true) },
    "grid.focusFilter": { disabled: !app.canUseDataView, run: () => activeDataView.handle?.focusSearch?.() },
    "view.commandPalette": { disabled: false, run: () => (app.paletteOpen = !app.paletteOpen) },
  });
</script>

<GlobalShortcuts {commands} {plat} onhelp={() => (app.shortcutsOpen = true)} />
<AppShell {app} {commands} {shortcutHint}>
  <AppDialogs {app} {commands} {plat} {shortcutHint} />
</AppShell>
