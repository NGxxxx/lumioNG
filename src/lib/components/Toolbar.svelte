<!-- src/lib/components/Toolbar.svelte -->
<script lang="ts">
  let {
    connected,
    canNewDoc,
    onsession,
    onrefresh,
    onnewdocument,
    onToggleLog,
    canRun = false,
    onrun = () => {},
  }: {
    connected: boolean;
    canNewDoc: boolean;
    onsession: () => void;
    onrefresh: () => void;
    onnewdocument: () => void;
    onToggleLog: () => void;
    canRun?: boolean;
    onrun?: () => void;
  } = $props();
</script>

<div class="toolbar">
  <!-- Session manager (always enabled) -->
  <button
    aria-label="Session manager"
    title="Session manager"
    class="btn-icon session"
    onclick={onsession}
  >
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="2.5" width="12" height="4" rx="1" fill="#dfe7ef" stroke="#5b7088" stroke-width="1"/>
      <rect x="2" y="9.5" width="12" height="4" rx="1" fill="#dfe7ef" stroke="#5b7088" stroke-width="1"/>
      <circle cx="4.6" cy="4.5" r="0.9" fill="#13aa52"/>
      <circle cx="4.6" cy="11.5" r="0.9" fill="#13aa52"/>
    </svg>
    <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8">
      <path d="M1 2.5 L4 5.5 L7 2.5" stroke="#666" stroke-width="1.1" fill="none"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Save (context-dependent, disabled) -->
  <button aria-label="Save" title="Save" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 2h9l3 3v9H2z" fill="#5a8fd6" stroke="#3a6db0" stroke-width="0.8"/>
      <rect x="5" y="2" width="5" height="4" fill="#dde9f7"/>
      <rect x="4.5" y="9" width="7" height="4" fill="#eef4fc"/>
    </svg>
  </button>

  <!-- New document (disabled when !canNewDoc) -->
  <button
    aria-label="New document"
    title="New document"
    class="btn-icon"
    disabled={!canNewDoc}
    onclick={onnewdocument}
  >
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 1.5h7l3 3v10H3z" fill="#fff" stroke="#888" stroke-width="0.9"/>
      <path d="M10 1.5v3h3" fill="none" stroke="#888" stroke-width="0.9"/>
      <path d="M8 7v5M5.5 9.5h5" stroke="#13aa52" stroke-width="1.4"/>
    </svg>
  </button>

  <!-- Delete document (context-dependent, disabled) -->
  <button aria-label="Delete document" title="Delete document" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 4h8l-1 10H5z" fill="#fff" stroke="#b04a4a" stroke-width="0.9"/>
      <path d="M3 4h10M6.5 4V2.5h3V4" stroke="#b04a4a" stroke-width="0.9" fill="none"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Refresh (disabled when not connected) -->
  <button
    aria-label="Refresh"
    title="Refresh"
    class="btn-icon"
    disabled={!connected}
    onclick={onrefresh}
  >
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M13 5a5.5 5.5 0 1 0 1 4" fill="none" stroke="#2f7dd1" stroke-width="1.4"/>
      <path d="M13.5 2v3.2H10.3z" fill="#2f7dd1"/>
    </svg>
  </button>

  <!-- Stop (context-dependent, disabled) -->
  <button aria-label="Stop" title="Stop" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="#d14545"/>
    </svg>
  </button>

  <!-- Run query (enabled when canRun) -->
  <button aria-label="Run query" title="Run query" class="btn-icon" disabled={!canRun} onclick={onrun}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 3l9 5-9 5z" fill="#1f9d4d"/>
    </svg>
  </button>

  <!-- Run selection (context-dependent, disabled) -->
  <button aria-label="Run selection" title="Run selection" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 3l6 5-6 5z" fill="#1f9d4d"/>
      <rect x="11" y="3" width="2.2" height="10" fill="#1f9d4d"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Find / filter (context-dependent, disabled) -->
  <button aria-label="Find" title="Find / filter" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="#555" stroke-width="1.3"/>
      <path d="M10.2 10.2 L14 14" stroke="#555" stroke-width="1.5"/>
    </svg>
  </button>

  <!-- Aggregate (context-dependent, disabled) -->
  <button aria-label="Aggregate" title="Aggregate" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 2h10l-4 6 4 6H3l4-6z" fill="none" stroke="#7b53b8" stroke-width="1.2"/>
    </svg>
  </button>

  <!-- Indexes (context-dependent, disabled) -->
  <button aria-label="Indexes" title="Indexes" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 4h10M3 8h10M3 12h7" stroke="#c98a2b" stroke-width="1.4"/>
      <circle cx="13" cy="12" r="1.4" fill="none" stroke="#c98a2b" stroke-width="1.1"/>
    </svg>
  </button>

  <div class="sep"></div>

  <!-- Edit document (context-dependent, disabled) -->
  <button aria-label="Edit document" title="Edit document" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 11l7-7 3 3-7 7H2z" fill="#f0d574" stroke="#b89534" stroke-width="0.9"/>
      <path d="M10 3l2-2 3 3-2 2z" fill="#9fb4cc" stroke="#5b7088" stroke-width="0.8"/>
    </svg>
  </button>

  <!-- Export JSON (context-dependent, disabled) -->
  <button aria-label="Export JSON" title="Export JSON" class="btn-icon" disabled>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M4 1.5h6l3 3v10H4z" fill="#fff" stroke="#888" stroke-width="0.9"/>
      <path d="M8 6v5M5.6 8.6L8 11l2.4-2.4" stroke="#2f7dd1" stroke-width="1.2" fill="none"/>
    </svg>
  </button>

  <!-- Command log (always enabled) -->
  <button aria-label="Command log" title="Command log" class="btn-icon" onclick={onToggleLog}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="#666" stroke-width="1.1"/>
      <path d="M4 5h8M4 8h8M4 11h5" stroke="#666" stroke-width="1.1"/>
    </svg>
  </button>

</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    height: 34px;
    background: var(--bg);
    border-bottom: 1px solid #d8d8d8;
    flex: none;
    padding: 0 4px;
    gap: 1px;
    user-select: none;
  }

  .btn-icon {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
    border: none;
    background: none;
    cursor: default;
    border-radius: 3px;
    line-height: 1;
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--menu-hover, #d9ebf9);
  }

  .btn-icon:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .sep {
    width: 1px;
    height: 20px;
    background: #d0d0d0;
    margin: 0 3px;
    flex: none;
  }

</style>
