<!-- src/lib/components/Toolbar.svelte -->
<script lang="ts">
  import * as m from "$lib/paraglide/messages";

  let {
    connected,
    canNewDoc,
    onsession,
    onrefresh,
    onnewdocument,
    onToggleLog,
    canRun = false,
    onrun = () => {},
    canRunSelection = false,
    onrunselection = () => {},
    canEditDoc = false,
    oneditdocument = () => {},
    canExport = false,
    onexport = () => {},
  }: {
    connected: boolean;
    canNewDoc: boolean;
    onsession: () => void;
    onrefresh: () => void;
    onnewdocument: () => void;
    onToggleLog: () => void;
    canRun?: boolean;
    onrun?: () => void;
    canRunSelection?: boolean;
    onrunselection?: () => void;
    canEditDoc?: boolean;
    oneditdocument?: () => void;
    canExport?: boolean;
    onexport?: () => void;
  } = $props();
</script>

<div class="toolbar">
  <!-- Session manager (always enabled) -->
  <button
    aria-label={m.toolbar_session_manager()}
    title={m.toolbar_session_manager()}
    class="btn-icon session"
    onclick={onsession}
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

  <div class="sep"></div>

  <!-- Save (context-dependent, disabled) -->
  <button aria-label={m.toolbar_save()} title={m.toolbar_save()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 2h9l3 3v9H2z" fill="var(--link)" stroke="var(--link-strong)" stroke-width="0.8"/>
      <rect x="5" y="2" width="5" height="4" fill="var(--blue-tint5)"/>
      <rect x="4.5" y="9" width="7" height="4" fill="var(--blue-tint5)"/>
    </svg>
  </button>

  <!-- New document (disabled when !canNewDoc) -->
  <button
    aria-label={m.toolbar_new_document()}
    title={m.toolbar_new_document()}
    class="btn-icon"
    disabled={!canNewDoc}
    onclick={onnewdocument}
  >
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 1.5h7l3 3v10H3z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
      <path d="M10 1.5v3h3" fill="none" stroke="var(--muted)" stroke-width="0.9"/>
      <path d="M8 7v5M5.5 9.5h5" stroke="var(--accent)" stroke-width="1.4"/>
    </svg>
  </button>

  <!-- Delete document (context-dependent, disabled) -->
  <button aria-label={m.toolbar_delete_document()} title={m.toolbar_delete_document()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 4h8l-1 10H5z" fill="var(--panel)" stroke="var(--danger)" stroke-width="0.9"/>
      <path d="M3 4h10M6.5 4V2.5h3V4" stroke="var(--danger)" stroke-width="0.9" fill="none"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Refresh (disabled when not connected) -->
  <button
    aria-label={m.toolbar_refresh()}
    title={m.toolbar_refresh()}
    class="btn-icon"
    disabled={!connected}
    onclick={onrefresh}
  >
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M13 5a5.5 5.5 0 1 0 1 4" fill="none" stroke="var(--link)" stroke-width="1.4"/>
      <path d="M13.5 2v3.2H10.3z" fill="var(--link)"/>
    </svg>
  </button>

  <!-- Stop (context-dependent, disabled) -->
  <button aria-label={m.toolbar_stop()} title={m.toolbar_stop()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="var(--danger)"/>
    </svg>
  </button>

  <!-- Run query (enabled when canRun) -->
  <button aria-label={m.toolbar_run_query()} title={m.toolbar_run_query()} class="btn-icon" disabled={!canRun} onclick={onrun}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 3l9 5-9 5z" fill="var(--run)"/>
    </svg>
  </button>

  <!-- Run selection (enabled when query tab has a highlighted statement) -->
  <button aria-label={m.toolbar_run_selection()} title={m.toolbar_run_selection()} class="btn-icon" disabled={!canRunSelection} onclick={onrunselection}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 3l6 5-6 5z" fill="var(--run)"/>
      <rect x="11" y="3" width="2.2" height="10" fill="var(--run)"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Find / filter (context-dependent, disabled) -->
  <button aria-label={m.toolbar_find()} title={m.toolbar_find_title()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="var(--muted)" stroke-width="1.3"/>
      <path d="M10.2 10.2 L14 14" stroke="var(--muted)" stroke-width="1.5"/>
    </svg>
  </button>

  <!-- Aggregate (context-dependent, disabled) -->
  <button aria-label={m.toolbar_aggregate()} title={m.toolbar_aggregate()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 2h10l-4 6 4 6H3l4-6z" fill="none" stroke="var(--type-object)" stroke-width="1.2"/>
    </svg>
  </button>

  <!-- Indexes (context-dependent, disabled) -->
  <button aria-label={m.toolbar_indexes()} title={m.toolbar_indexes()} class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 4h10M3 8h10M3 12h7" stroke="var(--warn)" stroke-width="1.4"/>
      <circle cx="13" cy="12" r="1.4" fill="none" stroke="var(--warn)" stroke-width="1.1"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Edit document (enabled when exactly one data-view row with an _id is selected) -->
  <button aria-label={m.toolbar_edit_document()} title={m.toolbar_edit_document()} class="btn-icon" disabled={!canEditDoc} onclick={oneditdocument}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 11l7-7 3 3-7 7H2z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.9"/>
      <path d="M10 3l2-2 3 3-2 2z" fill="var(--muted)" stroke="var(--muted)" stroke-width="0.8"/>
    </svg>
  </button>

  <!-- Export (enabled in the data view; exports the selection if any, else the filtered set) -->
  <button aria-label={m.toolbar_export()} title={m.toolbar_export()} class="btn-icon" disabled={!canExport} onclick={onexport}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 1.5h6l3 3v10H4z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
      <path d="M8 6v5M5.6 8.6L8 11l2.4-2.4" stroke="var(--link)" stroke-width="1.2" fill="none"/>
    </svg>
  </button>

  <!-- Command log (always enabled) -->
  <button aria-label={m.toolbar_command_log()} title={m.toolbar_command_log()} class="btn-icon" onclick={onToggleLog}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="var(--muted)" stroke-width="1.1"/>
      <path d="M4 5h8M4 8h8M4 11h5" stroke="var(--muted)" stroke-width="1.1"/>
    </svg>
  </button>

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

  .sep {
    width: 1px;
    height: 1.25rem;
    background: var(--gray-cf);
    margin: 0 0.1875rem;
    flex: none;
  }

</style>
