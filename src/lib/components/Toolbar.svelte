<!-- src/lib/components/Toolbar.svelte -->
<script lang="ts">
  import { settings } from "../stores/settings.svelte";
  import { tooltip } from "../actions/tooltip";
  import { SHORTCUTS, type Command, type CommandId } from "../domain/commands";
  import { formatCombo } from "../domain/shortcuts";
  import { detectPlatform } from "../stores/platform";
  import * as m from "$lib/paraglide/messages";

  let {
    commands,
    canNewDoc,
    canEditDoc = false,
    oneditdocument = () => {},
    canDeleteDoc = false,
    ondeletedocument = () => {},
    canFind = false,
    onfind = () => {},
    onToggleLog,
    logOpen = false,
    savedQueriesOpen = false,
    onToggleSavedQueries = () => {},
  }: {
    commands: Partial<Record<CommandId, Command>>;
    canNewDoc: boolean;
    canEditDoc?: boolean;
    oneditdocument?: () => void;
    canDeleteDoc?: boolean;
    ondeletedocument?: () => void;
    canFind?: boolean;
    onfind?: () => void;
    onToggleLog: () => void;
    logOpen?: boolean;
    savedQueriesOpen?: boolean;
    onToggleSavedQueries?: () => void;
  } = $props();

  const plat = detectPlatform();

  /** Appends the command's shortcut (if any) to a tooltip label, e.g. "Run query (F9)". */
  function tt(id: CommandId, label: string): string {
    const combo = SHORTCUTS[id];
    return combo ? `${label} (${formatCombo(combo, plat)})` : label;
  }

  function disabledOf(id: CommandId): boolean {
    return !commands[id] || commands[id]!.disabled;
  }
  function runOf(id: CommandId): () => void {
    return () => commands[id]?.run();
  }
</script>

<div class="toolbar">
  <!-- ── Connection: session + tree state ── -->
  <!-- Session manager (always enabled) -->
  <span class="tt" use:tooltip={tt("file.sessionManager", m.toolbar_session_manager())}>
    <button
      aria-label={m.toolbar_session_manager()}
      class="btn-icon session"
      disabled={disabledOf("file.sessionManager")}
      onclick={runOf("file.sessionManager")}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <rect x="2" y="2.5" width="12" height="4" rx="1" fill="var(--tab-inactive-bg)" stroke="var(--muted)" stroke-width="1"/>
        <rect x="2" y="9.5" width="12" height="4" rx="1" fill="var(--tab-inactive-bg)" stroke="var(--muted)" stroke-width="1"/>
        <circle cx="4.6" cy="4.5" r="0.9" fill="var(--accent)"/>
        <circle cx="4.6" cy="11.5" r="0.9" fill="var(--accent)"/>
      </svg>
      <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8">
        <path d="M1 2.5 L4 5.5 L7 2.5" stroke="var(--muted)" stroke-width="1.1" fill="none"/>
      </svg>
    </button>
  </span>

  <!-- Refresh -->
  <span class="tt" use:tooltip={tt("file.refresh", m.toolbar_refresh())}>
    <button
      aria-label={m.toolbar_refresh()}
      class="btn-icon"
      disabled={disabledOf("file.refresh")}
      onclick={runOf("file.refresh")}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M13 5a5.5 5.5 0 1 0 1 4" fill="none" stroke="var(--link)" stroke-width="1.4"/>
        <path d="M13.5 2v3.2H10.3z" fill="var(--link)"/>
      </svg>
    </button>
  </span>

  <div class="sep"></div>

  <!-- ── Document CRUD (Save also covers the active Query tab) ── -->
  <!-- Save (enabled when a document tab or a query tab is the active editor) -->
  <span class="tt" use:tooltip={tt("query.save", m.toolbar_save())}>
    <button aria-label={m.toolbar_save()} class="btn-icon" disabled={disabledOf("query.save")} onclick={runOf("query.save")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 2h9l3 3v9H2z" fill="var(--link)" stroke="var(--link-strong)" stroke-width="0.8"/>
        <rect x="5" y="2" width="5" height="4" fill="var(--blue-tint5)"/>
        <rect x="4.5" y="9" width="7" height="4" fill="var(--blue-tint5)"/>
      </svg>
    </button>
  </span>

  <!-- New document (disabled when !canNewDoc, e.g. no collection selected or session is read-only) -->
  <span class="tt" use:tooltip={tt("file.newDocument", m.toolbar_new_document())}>
    <button
      aria-label={m.toolbar_new_document()}
      class="btn-icon"
      disabled={disabledOf("file.newDocument")}
      onclick={runOf("file.newDocument")}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M3 1.5h7l3 3v10H3z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
        <path d="M10 1.5v3h3" fill="none" stroke="var(--muted)" stroke-width="0.9"/>
        <path d="M8 7v5M5.5 9.5h5" stroke="var(--accent)" stroke-width="1.4"/>
      </svg>
    </button>
  </span>

  <!-- Edit document (enabled when exactly one data-view row with an _id is selected, and session is not read-only) -->
  <span class="tt" use:tooltip={tt("grid.editDocument", m.toolbar_edit_document())}>
    <button aria-label={m.toolbar_edit_document()} class="btn-icon" disabled={!canEditDoc} onclick={oneditdocument}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 11l7-7 3 3-7 7H2z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.9"/>
        <path d="M10 3l2-2 3 3-2 2z" fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8"/>
      </svg>
    </button>
  </span>

  <!-- Delete document (enabled when the data view has a selection, and session is not read-only) -->
  <span class="tt" use:tooltip={tt("grid.deleteDocument", m.toolbar_delete_document())}>
    <button aria-label={m.toolbar_delete_document()} class="btn-icon" disabled={!canDeleteDoc} onclick={ondeletedocument}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M4 4h8l-1 10H5z" fill="var(--panel)" stroke="var(--danger)" stroke-width="0.9"/>
        <path d="M3 4h10M6.5 4V2.5h3V4" stroke="var(--danger)" stroke-width="0.9" fill="none"/>
      </svg>
    </button>
  </span>

  <div class="sep"></div>

  <!-- ── Query execution ── -->
  <!-- Run query -->
  <span class="tt" use:tooltip={tt("query.run", m.toolbar_run_query())}>
    <button aria-label={m.toolbar_run_query()} class="btn-icon" disabled={disabledOf("query.run")} onclick={runOf("query.run")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M4 3l9 5-9 5z" fill="var(--run)"/>
      </svg>
    </button>
  </span>

  <!-- Run selection -->
  <span class="tt" use:tooltip={tt("query.runSelection", m.toolbar_run_selection())}>
    <button aria-label={m.toolbar_run_selection()} class="btn-icon" disabled={disabledOf("query.runSelection")} onclick={runOf("query.runSelection")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M3 3l6 5-6 5z" fill="var(--run)"/>
        <rect x="11" y="3" width="2.2" height="10" fill="var(--run)"/>
      </svg>
    </button>
  </span>

  <!-- Stop (enabled only while the active query tab's script is actually running) -->
  <span class="tt" use:tooltip={tt("query.stop", m.toolbar_stop())}>
    <button aria-label={m.toolbar_stop()} class="btn-icon" disabled={disabledOf("query.stop")} onclick={runOf("query.stop")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <rect x="3" y="3" width="10" height="10" rx="1.5" fill="var(--danger)"/>
      </svg>
    </button>
  </span>

  <!-- Explain (enabled whenever a query tab is active; re-runs first if not yet explainable) -->
  <span class="tt" use:tooltip={tt("query.explain", m.toolbar_explain())}>
    <button aria-label={m.toolbar_explain()} class="btn-icon" disabled={disabledOf("query.explain")} onclick={runOf("query.explain")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="7" cy="7" r="4.2" fill="none" stroke="var(--muted)" stroke-width="1.3"/>
        <path d="M10.2 10.2 L14 14" stroke="var(--muted)" stroke-width="1.5"/>
        <rect x="5" y="7.5" width="1.2" height="2" fill="var(--run)"/>
        <rect x="6.8" y="6" width="1.2" height="3.5" fill="var(--run)"/>
        <rect x="8.6" y="4.7" width="1.2" height="4.8" fill="var(--run)"/>
      </svg>
    </button>
  </span>

  <div class="sep"></div>

  <!-- ── Data navigation ── -->
  <!-- Find / filter (enabled in the Data view or an active Query tab; focuses its search box) -->
  <span class="tt" use:tooltip={tt("grid.focusFilter", m.toolbar_find_title())}>
    <button aria-label={m.toolbar_find()} class="btn-icon" disabled={!canFind} onclick={onfind}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="7" cy="7" r="4.2" fill="none" stroke="var(--muted)" stroke-width="1.3"/>
        <path d="M10.2 10.2 L14 14" stroke="var(--muted)" stroke-width="1.5"/>
      </svg>
    </button>
  </span>

  <!-- Aggregate (enabled when a collection is selected; opens a new Query tab with a starter pipeline) -->
  <span class="tt" use:tooltip={tt("query.aggregate", m.toolbar_aggregate())}>
    <button aria-label={m.toolbar_aggregate()} class="btn-icon" disabled={disabledOf("query.aggregate")} onclick={runOf("query.aggregate")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M3 2h10l-4 6 4 6H3l4-6z" fill="none" stroke="var(--type-object)" stroke-width="1.2"/>
      </svg>
    </button>
  </span>

  <div class="sep"></div>

  <!-- ── Import / export ── -->
  <!-- Export (enabled in the data view; exports the selection if any, else the filtered set) -->
  <span class="tt" use:tooltip={tt("file.export", m.toolbar_export())}>
    <button aria-label={m.toolbar_export()} class="btn-icon" disabled={disabledOf("file.export")} onclick={runOf("file.export")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M4 1.5h6l3 3v10H4z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
        <path d="M8 6v5M5.6 8.6L8 11l2.4-2.4" stroke="var(--link)" stroke-width="1.2" fill="none"/>
      </svg>
    </button>
  </span>

  <!-- Import (enabled when a database or collection is selected and session is not read-only; imports from a JSON/JSONL/BSON/SQL/CSV file) -->
  <span class="tt" use:tooltip={tt("file.import", m.toolbar_import())}>
    <button aria-label={m.toolbar_import()} class="btn-icon" disabled={disabledOf("file.import")} onclick={runOf("file.import")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M4 1.5h6l3 3v10H4z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
        <path d="M8 11V6M5.6 8.4L8 6l2.4 2.4" stroke="var(--link)" stroke-width="1.2" fill="none"/>
      </svg>
    </button>
  </span>

  <div class="sep"></div>

  <!-- ── View toggles (persistent on/off state, not one-shot actions) ── -->
  <!-- Wrap long lines (always enabled — shared across Tree view, Edit Document, query cells) -->
  <span class="tt" use:tooltip={m.wrap_toggle_title()}>
    <button
      aria-label={m.wrap_toggle_label()}
      class="btn-icon"
      class:active={settings.wrapLongLines}
      onclick={() => settings.setWrapLongLines(!settings.wrapLongLines)}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 4.5h12M2 8h8.5M2 11.5h8.5" stroke="var(--muted)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        <path d="M10.5 11.5h2.5v-2.2M13 11.5l-1.8-1.8" stroke="var(--muted)" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </span>

  <!-- Command log (always enabled) -->
  <span class="tt" use:tooltip={m.toolbar_command_log()}>
    <button
      aria-label={m.toolbar_command_log()}
      class="btn-icon"
      class:active={logOpen}
      onclick={onToggleLog}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="var(--muted)" stroke-width="1.1"/>
        <path d="M4 5h8M4 8h8M4 11h5" stroke="var(--muted)" stroke-width="1.1"/>
      </svg>
    </button>
  </span>

  <!-- Saved queries panel (always enabled) -->
  <span class="tt" use:tooltip={m.toolbar_saved_queries()}>
    <button
      aria-label={m.toolbar_saved_queries()}
      class="btn-icon"
      class:active={savedQueriesOpen}
      onclick={onToggleSavedQueries}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M4 2h6l2.5 2.5V14H4z" fill="none" stroke="var(--muted)" stroke-width="1.1"/>
        <path d="M6 6.5l1.3 1.3L9.5 5.3" stroke="var(--run)" stroke-width="1.2" fill="none"/>
        <path d="M6 10.5h4" stroke="var(--muted)" stroke-width="1.1"/>
      </svg>
    </button>
  </span>

</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    height: 2.125rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex: none;
    padding: 0 0.25rem;
    gap: 0.0625rem;
    user-select: none;
  }

  /* Real box (not display:contents) so hover still fires while the inner button is disabled. */
  .tt {
    display: inline-flex;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3125rem;
    border: none;
    background: none;
    cursor: default;
    border-radius: 0.1875rem;
    line-height: 1;
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--menu-hover);
  }

  .btn-icon:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-icon.active {
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--toggle-on-ring);
  }

  .sep {
    width: 1px;
    height: 1.25rem;
    background: var(--gray-cf);
    margin: 0 0.1875rem;
    flex: none;
  }

</style>
