<script lang="ts">
  import { onMount } from "svelte";
  import { createConnectionRegistry } from "../stores/connections.svelte";

  let {
    onconnected,
    onclose,
  }: {
    onconnected: (c: { label: string; uri: string }) => void;
    onclose: () => void;
  } = $props();

  const r = createConnectionRegistry();

  // Selected session id in left panel
  let selectedId = $state<number | null>(null);
  // Filter text
  let filterText = $state("");

  const filteredList = $derived(
    filterText.trim()
      ? r.list.filter((c) =>
          c.label.toLowerCase().includes(filterText.toLowerCase()) ||
          c.uri.toLowerCase().includes(filterText.toLowerCase())
        )
      : r.list,
  );

  function selectSession(c: { id: number; label: string; uri: string }) {
    selectedId = c.id;
    r.edit(c);
  }

  function newSession() {
    selectedId = null;
    r.clearForm();
  }

  async function openSession() {
    const connUri = r.uri.trim();
    const connLabel = r.label.trim() || connUri;
    if (!connUri) return;
    if (await r.connectTo(connUri)) {
      onconnected({ label: connLabel, uri: connUri });
      onclose();
    }
  }

  onMount(() => {
    r.load();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
  onkeydown={(e) => { if (e.key === "Escape") onclose(); }}
>
  <div class="panel">
    <!-- Header -->
    <div class="header">
      <span class="header-title">Session manager</span>
      <button class="close-btn" onclick={onclose} title="Close" aria-label="Close">
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path d="M1 1 L10 10 M10 1 L1 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- Body: two columns -->
    <div class="body">
      <!-- Left column: session list -->
      <div class="left-col">
        <!-- Filter bar -->
        <div class="filter-bar">
          <div class="filter-input-wrap">
            <svg class="filter-icon" width="12" height="12" viewBox="0 0 16 16">
              <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="#aaa" stroke-width="1.5"/>
              <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#aaa" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input
              class="filter-input"
              bind:value={filterText}
              placeholder="Filter"
              aria-label="Filter sessions"
            />
          </div>
          {#if filterText}
            <button class="filter-clear" onclick={() => (filterText = "")} title="Clear filter">✕</button>
          {/if}
        </div>

        <!-- Column headers -->
        <div class="list-header">
          <span class="col-name">Session name</span>
          <span class="col-last">Last connect</span>
        </div>

        <!-- Session list -->
        <div class="session-list">
          {#each filteredList as c (c.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="session-row"
              class:selected={selectedId === c.id}
              onclick={() => selectSession(c)}
              title={c.uri}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" class="session-icon">
                <path d="M12 2c-4 0-7 1.6-7 3.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6C19 3.6 16 2 12 2z" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "#888"} stroke-width="1.8"/>
                <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "#888"} stroke-width="1.8"/>
              </svg>
              <span class="session-name">{c.label}</span>
              <span class="session-last">—</span>
            </div>
          {/each}
          {#if filteredList.length === 0}
            <div class="session-empty">No saved sessions</div>
          {/if}
        </div>
      </div>

      <!-- Right column: form -->
      <div class="right-col">
        <!-- URI field (the actual connect field) -->
        <div class="form-grid">
          <span class="form-label">Session name:</span>
          <input class="form-input" bind:value={r.label} placeholder="e.g. Local Dev" />

          <span class="form-label">Connection URI:</span>
          <input class="form-input mono" bind:value={r.uri} placeholder="mongodb://localhost:27017" />

          <span class="form-label form-muted">Connection type:</span>
          <div class="form-fake select-fake" title="Defined by the URI schema">
            <span>Direct connection (URI)</span>
            <span class="arrow">▾</span>
          </div>

          <span class="form-label form-muted">Hostname / IP:</span>
          <div class="form-fake mono disabled" title="Set via URI">localhost</div>

          <span class="form-label form-muted">Port:</span>
          <div class="form-fake mono disabled short" title="Set via URI">27017</div>

          <span class="form-label form-muted">Authentication:</span>
          <div class="form-fake select-fake disabled" title="Set via URI">
            <span>Defined by URI</span>
            <span class="arrow">▾</span>
          </div>

          <span class="form-label form-muted">User:</span>
          <div class="form-fake mono disabled" title="Set via URI">(optional — in URI)</div>

          <span class="form-label form-muted">Password:</span>
          <div class="form-fake mono disabled" title="Set via URI">(optional — in URI)</div>

          <span class="form-label form-muted">Auth database:</span>
          <div class="form-fake mono disabled" title="Set via URI">(optional — in URI)</div>

          <span class="form-label form-muted">Replica set:</span>
          <div class="form-fake disabled" title="Set via URI">(optional)</div>

          <span class="form-label form-muted">Read preference:</span>
          <div class="form-fake select-fake disabled" title="Set via URI">
            <span>primary</span>
            <span class="arrow">▾</span>
          </div>
        </div>

        {#if r.formError}
          <div class="form-error">{r.formError}</div>
        {/if}
        {#if r.error}
          <div class="form-error">{r.error}</div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left">
        <button class="foot-btn new-btn" onclick={newSession}>
          <span class="plus">+</span>New
        </button>
        <button class="foot-btn" onclick={r.save} disabled={!r.label.trim() && !r.uri.trim()}>
          {r.editingId !== null ? "Update" : "Save"}
        </button>
        <button
          class="foot-btn del-btn"
          onclick={() => { if (selectedId !== null) { r.remove(selectedId); selectedId = null; r.clearForm(); } }}
          disabled={selectedId === null}
        >
          <span class="del-x">✕</span>Delete
        </button>
      </div>
      <div class="footer-right">
        <button
          class="foot-btn open-btn"
          onclick={openSession}
          disabled={r.connecting || !r.uri.trim()}
        >
          {r.connecting ? "Connecting…" : "Open"}
        </button>
        <button class="foot-btn cancel-btn" onclick={onclose}>Cancel</button>
      </div>
    </div>
  </div>
</div>

<style>
  @keyframes msFade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    animation: msFade 0.12s ease;
  }

  .panel {
    width: 880px;
    height: 560px;
    background: var(--bg);
    border: 1px solid #888;
    border-radius: 6px;
    box-shadow: 0 14px 48px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    height: 34px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 0 12px;
    flex: none;
  }
  .header-title {
    font-weight: 600;
    font-size: 12px;
    color: var(--fg);
  }
  .close-btn {
    margin-left: auto;
    width: 30px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 3px;
    color: #555;
    padding: 0;
  }
  .close-btn:hover {
    background: #e81123;
    color: #fff;
  }

  /* Body */
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* Left column */
  .left-col {
    width: 330px;
    flex: none;
    border-right: 1px solid #d0d0d0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }

  .filter-bar {
    display: flex;
    gap: 6px;
    padding: 8px;
    align-items: center;
    flex: none;
  }
  .filter-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    height: 24px;
    border: 1px solid #c4c4c4;
    border-radius: 2px;
    padding: 0 6px;
    background: #fff;
    gap: 4px;
  }
  .filter-icon { flex: none; }
  .filter-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 12px;
    background: transparent;
    color: var(--fg);
    min-width: 0;
  }
  .filter-input::placeholder { color: #aaa; }
  .filter-clear {
    width: 24px;
    height: 24px;
    border: 1px solid #c4c4c4;
    border-radius: 2px;
    background: #fff;
    color: #c0504d;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 11px;
    flex: none;
  }
  .filter-clear:hover { background: #fdeeee; }

  .list-header {
    display: flex;
    padding: 0 8px 4px;
    color: #777;
    font-size: 11px;
    flex: none;
  }
  .col-name { flex: 1; }
  .col-last { width: 90px; }

  .session-list {
    flex: 1;
    overflow: auto;
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    cursor: default;
    font-size: 12px;
    border-bottom: 1px solid #f0f0f0;
  }
  .session-row:hover {
    background: var(--row-hover);
  }
  .session-row.selected {
    background: var(--row-selected);
    outline: 1px solid var(--row-selected-ring);
    outline-offset: -1px;
  }
  .session-icon { flex: none; }
  .session-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-last { width: 90px; color: #888; font-size: 11px; }
  .session-empty { padding: 16px 8px; color: var(--muted); font-size: 12px; }

  /* Right column */
  .right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    min-width: 0;
    padding: 16px 18px;
    overflow: auto;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 10px 12px;
    align-items: center;
    max-width: 440px;
  }

  .form-label {
    color: #444;
    font-size: 12px;
    text-align: right;
  }
  .form-label.form-muted {
    color: #888;
  }

  .form-input {
    height: 24px;
    border: 1px solid #c4c4c4;
    border-radius: 2px;
    padding: 0 8px;
    font-size: 12px;
    background: #fff;
    color: var(--fg);
    font-family: inherit;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .form-input:focus { border-color: #5aabff; }
  .form-input.mono { font-family: var(--mono); }

  .form-fake {
    display: flex;
    align-items: center;
    height: 24px;
    background: #fff;
    border: 1px solid #c4c4c4;
    border-radius: 2px;
    padding: 0 8px;
    font-size: 12px;
    color: #999;
    box-sizing: border-box;
    width: 100%;
  }
  .form-fake.mono { font-family: var(--mono); }
  .form-fake.short { width: 90px; }
  .form-fake.select-fake { justify-content: space-between; }
  .form-fake.disabled { background: #f5f5f5; cursor: default; }
  .arrow { color: #888; font-size: 10px; }

  .form-error {
    margin-top: 10px;
    color: #b71c1c;
    font-size: 12px;
  }

  /* Footer */
  .footer {
    display: flex;
    align-items: center;
    height: 46px;
    flex: none;
    border-top: 1px solid #cfcfcf;
    padding: 0 10px;
    gap: 8px;
    background: var(--bg);
  }
  .footer-left { display: flex; gap: 5px; align-items: center; }
  .footer-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }

  .foot-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 12px;
    background: var(--panel);
    border: 1px solid #b8b8b8;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg);
    font-family: inherit;
  }
  .foot-btn:hover:not(:disabled) { background: #f3f3f3; }
  .foot-btn:disabled { opacity: 0.5; cursor: default; }

  .new-btn .plus { color: var(--accent); font-weight: 700; }
  .new-btn:hover:not(:disabled) { background: #f3f9ee; }

  .del-btn .del-x { color: #c0504d; }
  .del-btn:hover:not(:disabled) { background: #fdeeee; }

  .open-btn {
    height: 28px;
    padding: 0 22px;
    background: var(--accent);
    color: #fff;
    border-color: transparent;
    font-weight: 600;
  }
  .open-btn:hover:not(:disabled) { background: #1a8a43; }
  .open-btn:disabled { background: #7cc9a3; cursor: default; opacity: 1; }

  .cancel-btn { height: 28px; padding: 0 22px; }
  .cancel-btn:hover { background: #eee; }
</style>
