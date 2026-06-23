<script lang="ts">
  import { onMount } from "svelte";
  import { createConnectionRegistry } from "../stores/connections.svelte";
  import type { SavedConnection } from "../api/connections";
  import * as m from "$lib/paraglide/messages";

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
  // Import URI local state
  let importUri = $state("");

  const filteredList = $derived(
    filterText.trim()
      ? r.list.filter((c) =>
          c.label.toLowerCase().includes(filterText.toLowerCase()) ||
          c.host.toLowerCase().includes(filterText.toLowerCase())
        )
      : r.list,
  );

  function selectSession(c: SavedConnection) {
    selectedId = c.id;
    r.edit(c);
  }

  /** Double-click a saved session = select it + connect immediately (no Open click). */
  function openSessionRow(c: SavedConnection) {
    selectSession(c);
    openSession();
  }

  function newSession() {
    selectedId = null;
    r.clearForm();
  }

  async function openSession() {
    if (!r.host.trim()) return;
    const connLabel = r.label.trim() || r.currentUri();
    if (await r.connectTo()) {
      onconnected({ label: connLabel, uri: r.currentUri() });
      onclose();
    }
  }

  function doImport() {
    if (importUri.trim()) { r.importFromUri(importUri.trim()); importUri = ""; }
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
      <span class="header-title">{m.session_manager_title()}</span>
      <button class="close-btn" onclick={onclose} title={m.session_manager_close()} aria-label={m.session_manager_close()}>
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11">
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
            <svg aria-hidden="true" class="filter-icon" width="12" height="12" viewBox="0 0 16 16">
              <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="#aaa" stroke-width="1.5"/>
              <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#aaa" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input
              class="filter-input"
              bind:value={filterText}
              placeholder={m.session_manager_filter_placeholder()}
              aria-label={m.session_manager_filter_aria()}
            />
          </div>
          {#if filterText}
            <button class="filter-clear" onclick={() => (filterText = "")} title={m.session_manager_filter_clear_title()}>✕</button>
          {/if}
        </div>

        <!-- Column headers -->
        <div class="list-header">
          <span class="col-name">{m.session_manager_col_name()}</span>
          <span class="col-last">{m.session_manager_col_last()}</span>
        </div>

        <!-- Session list -->
        <div class="session-list">
          {#each filteredList as c (c.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="session-row"
              class:selected={selectedId === c.id}
              onclick={() => selectSession(c)}
              ondblclick={() => openSessionRow(c)}
              title={`${c.host} — ${m.session_manager_row_connect_hint()}`}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" class="session-icon">
                <path d="M12 2c-4 0-7 1.6-7 3.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6C19 3.6 16 2 12 2z" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "#888"} stroke-width="1.8"/>
                <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "#888"} stroke-width="1.8"/>
              </svg>
              <span class="session-name">{c.label}</span>
              <span class="session-last">—</span>
            </div>
          {/each}
          {#if filteredList.length === 0}
            <div class="session-empty">{m.session_manager_empty()}</div>
          {/if}
        </div>
      </div>

      <!-- Right column: form -->
      <div class="right-col">
        <div class="form-grid">
          <span class="form-label">{m.session_manager_label_session_name()}</span>
          <input class="form-input" bind:value={r.label} placeholder="e.g. Local Dev" aria-label={m.session_manager_col_name()} />

          <span class="form-label">{m.session_manager_label_conn_type()}</span>
          <select class="form-input" bind:value={r.scheme} aria-label={m.session_manager_label_conn_type()}>
            <option value="mongodb">{m.session_manager_conn_direct()}</option>
            <option value="mongodb+srv">{m.session_manager_conn_srv()}</option>
          </select>

          <span class="form-label">{m.session_manager_label_hostname()}</span>
          <input class="form-input mono" bind:value={r.host} placeholder="localhost" aria-label={m.session_manager_label_hostname()} />

          <span class="form-label">{m.session_manager_label_port()}</span>
          <input
            class="form-input mono short"
            type="number"
            bind:value={r.port}
            disabled={r.scheme === "mongodb+srv"}
            placeholder="27017"
            aria-label={m.session_manager_label_port()}
          />

          <span class="form-label">{m.session_manager_label_auth()}</span>
          <select class="form-input" bind:value={r.authMethod} aria-label={m.session_manager_label_auth()}>
            <option value="none">{m.session_manager_auth_none()}</option>
            <option value="password">{m.session_manager_auth_password()}</option>
          </select>

          <span class="form-label">{m.session_manager_label_user()}</span>
          <input class="form-input" bind:value={r.user} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_user()} />

          <span class="form-label">{m.session_manager_label_password()}</span>
          <input class="form-input" type="password" bind:value={r.password} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_password()} />

          <span class="form-label">{m.session_manager_label_auth_db()}</span>
          <input class="form-input mono" bind:value={r.authSource} placeholder="admin" aria-label={m.session_manager_label_auth_db()} />

          <span class="form-label">{m.session_manager_label_replica_set()}</span>
          <input class="form-input mono" bind:value={r.replicaSet} placeholder="(optional)" aria-label={m.session_manager_label_replica_set()} />

          <span class="form-label">{m.session_manager_label_tls()}</span>
          <label class="form-check">
            <input type="checkbox" bind:checked={r.tls} aria-label={m.session_manager_label_tls()} />
            <span>{m.session_manager_tls_enable()}</span>
          </label>

          <span class="form-label">{m.session_manager_label_extra()}</span>
          <input class="form-input mono" bind:value={r.extraOptions} placeholder="readPreference=secondary&appName=x" aria-label={m.session_manager_label_extra()} />

          <span class="form-label">{m.session_manager_label_import_uri()}</span>
          <div class="import-row">
            <input class="form-input mono" bind:value={importUri} placeholder="paste a mongodb:// URI" aria-label={m.session_manager_label_import_uri()} />
            <button type="button" class="import-btn" onclick={doImport}>{m.session_manager_import_btn()}</button>
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
          <span class="plus">+</span>{m.session_manager_btn_new()}
        </button>
        <button class="foot-btn" onclick={r.save} disabled={!r.label.trim() && !r.host.trim()}>
          {r.editingId !== null ? m.session_manager_btn_update() : m.session_manager_btn_save()}
        </button>
        <button
          class="foot-btn del-btn"
          onclick={() => { if (selectedId !== null) { r.remove(selectedId); selectedId = null; r.clearForm(); } }}
          disabled={selectedId === null}
        >
          <span class="del-x">✕</span>{m.session_manager_btn_delete()}
        </button>
      </div>
      <div class="footer-right">
        <button
          class="foot-btn open-btn"
          onclick={openSession}
          disabled={r.connecting || !r.host.trim()}
        >
          {r.connecting ? m.session_manager_btn_connecting() : m.session_manager_btn_open()}
        </button>
        <button class="foot-btn cancel-btn" onclick={onclose}>{m.session_manager_btn_cancel()}</button>
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Overlay & panel ── */
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
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    background: var(--bg);
    border: 1px solid #888;
    border-radius: 6px;
    box-shadow: 0 14px 48px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
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

  /* ── Body ── */
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* ── Left column: session list ── */
  .left-col {
    width: 330px;
    flex: none;
    border-right: 1px solid #d0d0d0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }

  /* ── Filter bar ── */
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

  /* ── Session list rows ── */
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

  /* ── Right column: connection form ── */
  .right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    min-width: 0;
    padding: 16px 18px;
    overflow: auto;
  }

  /* ── Form grid & inputs ── */
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
  .form-input.short { width: 90px; }
  .form-input:disabled { background: #f5f5f5; color: #999; cursor: default; }

  .form-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg); }
  .import-row { display: flex; gap: 6px; }
  .import-row .form-input { flex: 1; }
  .import-btn {
    height: 24px; padding: 0 10px; border: 1px solid #b8b8b8; border-radius: 2px;
    background: var(--panel); cursor: pointer; font-size: 12px; color: var(--fg); flex: none;
  }
  .import-btn:hover { background: #f3f3f3; }

  .form-error {
    margin-top: 10px;
    color: #b71c1c;
    font-size: 12px;
  }

  /* ── Footer ── */
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

  /* ── Footer buttons ── */
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
