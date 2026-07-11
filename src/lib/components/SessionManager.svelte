<script lang="ts">
  import { onMount } from "svelte";
  import { createConnectionRegistry } from "../stores/connections.svelte";
  import type { SavedConnection } from "../api/connections";
  import { openDialog } from "../api/files";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import TestConnectionDialog from "./TestConnectionDialog.svelte";
  import * as m from "$lib/paraglide/messages";
  import { appLocale } from "../stores/locale.svelte";
  import { relativeParts } from "../domain/recency";

  let {
    onconnected,
    onclose,
  }: {
    onconnected: (c: { connId: number | null; label: string; uri: string; readOnly: boolean; ssh: import("../api/connection").SshConnectInput | null }) => Promise<boolean>;
    onclose: () => void;
  } = $props();

  const r = createConnectionRegistry();

  let selectedId = $state<number | null>(null);
  let filterText = $state("");
  let importUri = $state("");
  let connecting = $state(false);
  // Distinct from r.error, which is validation/CRUD errors.
  let connectError = $state<string | null>(null);
  let confirmDelete = $state<SavedConnection | null>(null);

  let activeTab = $state<"general" | "ssh">("general");
  let testing = $state(false);
  let testResult = $state<{ ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string } | null>(null);

  async function pickCertFile() {
    const path = await openDialog([{ name: "PEM", extensions: ["pem", "crt", "cer"] }]);
    if (path) r.tlsCertificateKeyFile = path;
  }
  async function pickSshKeyFile() {
    const path = await openDialog([{ name: "All files", extensions: ["*"] }]);
    if (path) r.sshPrivateKeyPath = path;
  }
  async function doTest() {
    testing = true;
    testResult = null;
    try {
      testResult = await r.testConnection();
    } finally {
      testing = false;
    }
  }

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

  function formatLast(c: SavedConnection): string {
    if (c.lastConnectedAt == null) return m.session_manager_last_never();
    const { value, unit } = relativeParts(c.lastConnectedAt, Date.now());
    return new Intl.RelativeTimeFormat(appLocale.current, { numeric: "auto" }).format(value, unit);
  }

  function absoluteLast(c: SavedConnection): string | undefined {
    return c.lastConnectedAt == null ? undefined : new Date(c.lastConnectedAt).toLocaleString();
  }

  async function openSession() {
    if (!r.host.trim()) return;
    const result = r.connectTo();
    if (!result.ok) return; // validation error shown via r.error
    connectError = null;
    connecting = true;
    try {
      const connLabel = r.label.trim() || result.uri;
      // Pass the saved connection's numeric id (null for ad-hoc connections with no saved record).
      const connId = selectedId !== null ? selectedId : (r.editingId ?? null);
      const ok = await onconnected({ connId, label: connLabel, uri: result.uri, readOnly: r.readOnly, ssh: result.ssh });
      if (ok) onclose();
      else connectError = "Connection failed. Check your connection settings and try again.";
    } finally {
      connecting = false;
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
              <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--muted)" stroke-width="1.5"/>
              <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round"/>
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
                <path d="M12 2c-4 0-7 1.6-7 3.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6C19 3.6 16 2 12 2z" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "var(--muted)"} stroke-width="1.8"/>
                <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "var(--muted)"} stroke-width="1.8"/>
              </svg>
              <span class="session-name">{c.label}</span>
              <span class="session-last" title={absoluteLast(c)}>{formatLast(c)}</span>
            </div>
          {/each}
          {#if filteredList.length === 0}
            <div class="session-empty">{m.session_manager_empty()}</div>
          {/if}
        </div>
      </div>

      <!-- Right column: form -->
      <div class="right-col">
        <div class="view-toggle">
          <button type="button" class="toggle-btn" class:toggle-active={activeTab === "general"} onclick={() => (activeTab = "general")}>
            {m.session_manager_tab_general()}
          </button>
          <button type="button" class="toggle-btn" class:toggle-active={activeTab === "ssh"} onclick={() => (activeTab = "ssh")}>
            {m.session_manager_tab_ssh()}
          </button>
        </div>

        {#if activeTab === "general"}
          <div class="form-grid">
            <span class="form-label">{m.session_manager_label_session_name()}</span>
            <input class="form-input" bind:value={r.label} placeholder="e.g. Local Dev" aria-label={m.session_manager_col_name()} />

            <span class="form-label">{m.session_manager_label_conn_type()}</span>
            <select class="form-input" bind:value={r.scheme} aria-label={m.session_manager_label_conn_type()}>
              <option value="mongodb">{m.session_manager_conn_direct()}</option>
              {#if !r.sshEnabled}
                <option value="mongodb+srv">{m.session_manager_conn_srv()}</option>
              {/if}
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
              <option value="x509">{m.session_manager_auth_x509()}</option>
              <option value="ldap">{m.session_manager_auth_ldap()}</option>
            </select>

            {#if r.authMethod !== "x509"}
              <span class="form-label">{m.session_manager_label_user()}</span>
              <input class="form-input" bind:value={r.user} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_user()} />

              <span class="form-label">{m.session_manager_label_password()}</span>
              <input class="form-input" type="password" bind:value={r.password} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_password()} />
            {:else}
              <span class="form-label">{m.session_manager_label_cert_file()}</span>
              <div class="import-row">
                <input class="form-input mono" readonly value={r.tlsCertificateKeyFile} aria-label={m.session_manager_label_cert_file()} />
                <button type="button" class="import-btn" onclick={pickCertFile}>{m.session_manager_btn_choose_file()}</button>
              </div>

              <span class="form-label">{m.session_manager_label_cert_passphrase()}</span>
              <input class="form-input" type="password" bind:value={r.tlsCertificateKeyFilePassword} aria-label={m.session_manager_label_cert_passphrase()} />
            {/if}

            <span class="form-label">{m.session_manager_label_auth_db()}</span>
            <input
              class="form-input mono"
              value={r.authMethod === "ldap" ? "$external" : r.authSource}
              oninput={(e) => { r.authSource = e.currentTarget.value; }}
              disabled={r.authMethod === "x509" || r.authMethod === "ldap"}
              placeholder="admin"
              aria-label={m.session_manager_label_auth_db()}
            />

            <span class="form-label">{m.session_manager_label_replica_set()}</span>
            <input class="form-input mono" bind:value={r.replicaSet} disabled={r.sshEnabled} title={r.sshEnabled ? m.session_manager_tooltip_ssh_lock() : undefined} placeholder="(optional)" aria-label={m.session_manager_label_replica_set()} />

            <span class="form-label">{m.session_manager_label_tls()}</span>
            <label class="form-check">
              <input
                type="checkbox"
                checked={r.tls || r.authMethod === "x509" || r.authMethod === "ldap"}
                onchange={(e) => { r.tls = e.currentTarget.checked; }}
                disabled={r.authMethod === "x509" || r.authMethod === "ldap"}
                aria-label={m.session_manager_label_tls()}
              />
              <span>{m.session_manager_tls_enable()}</span>
            </label>

            <span class="form-label">{m.session_manager_label_readonly()}</span>
            <label class="form-check">
              <input type="checkbox" bind:checked={r.readOnly} aria-label={m.session_manager_label_readonly()} />
              <span>{m.session_manager_readonly_enable()}</span>
            </label>

            <span class="form-label">{m.session_manager_label_extra()}</span>
            <input class="form-input mono" bind:value={r.extraOptions} placeholder="readPreference=secondary&appName=x" aria-label={m.session_manager_label_extra()} />

            <span class="form-label">{m.session_manager_label_import_uri()}</span>
            <div class="import-row">
              <input class="form-input mono" bind:value={importUri} placeholder="paste a mongodb:// URI" aria-label={m.session_manager_label_import_uri()} />
              <button type="button" class="import-btn" onclick={doImport}>{m.session_manager_import_btn()}</button>
            </div>
          </div>
        {:else}
          <div class="form-grid">
            <span class="form-label">{m.session_manager_ssh_enable()}</span>
            <label class="form-check">
              <input type="checkbox" bind:checked={r.sshEnabled} aria-label={m.session_manager_ssh_enable()} />
              <span>{m.session_manager_ssh_enable()}</span>
            </label>

            {#if r.sshEnabled}
              <span class="form-label"></span>
              <div class="form-notice">{m.session_manager_ssh_notice()}</div>

              <span class="form-label">{m.session_manager_label_ssh_host()}</span>
              <input class="form-input mono" bind:value={r.sshHost} aria-label={m.session_manager_label_ssh_host()} />

              <span class="form-label">{m.session_manager_label_ssh_port()}</span>
              <input class="form-input mono short" type="number" bind:value={r.sshPort} placeholder="22" aria-label={m.session_manager_label_ssh_port()} />

              <span class="form-label">{m.session_manager_label_ssh_user()}</span>
              <input class="form-input" bind:value={r.sshUser} aria-label={m.session_manager_label_ssh_user()} />

              <span class="form-label">{m.session_manager_label_ssh_auth()}</span>
              <select class="form-input" bind:value={r.sshAuthMethod} aria-label={m.session_manager_label_ssh_auth()}>
                <option value="password">{m.session_manager_ssh_auth_password()}</option>
                <option value="key">{m.session_manager_ssh_auth_key()}</option>
              </select>

              {#if r.sshAuthMethod === "password"}
                <span class="form-label">{m.session_manager_label_ssh_password()}</span>
                <input class="form-input" type="password" bind:value={r.sshPassword} aria-label={m.session_manager_label_ssh_password()} />
              {:else}
                <span class="form-label">{m.session_manager_label_ssh_key_file()}</span>
                <div class="import-row">
                  <input class="form-input mono" readonly value={r.sshPrivateKeyPath} aria-label={m.session_manager_label_ssh_key_file()} />
                  <button type="button" class="import-btn" onclick={pickSshKeyFile}>{m.session_manager_btn_choose_file()}</button>
                </div>

                <span class="form-label">{m.session_manager_label_ssh_passphrase()}</span>
                <input class="form-input" type="password" bind:value={r.sshPassphrase} aria-label={m.session_manager_label_ssh_passphrase()} />
              {/if}
            {/if}
          </div>
        {/if}

        {#if r.formError}
          <div class="form-error">{r.formError}</div>
        {/if}
        {#if r.error}
          <div class="form-error">{r.error}</div>
        {/if}
        {#if connectError}
          <div class="form-error">{connectError}</div>
        {/if}
      </div>
    </div>

    {#if testResult}
      <TestConnectionDialog result={testResult} onclose={() => (testResult = null)} />
    {/if}

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
          onclick={() => { const c = r.list.find((x) => x.id === selectedId); if (c) confirmDelete = c; }}
          disabled={selectedId === null}
        >
          <span class="del-x">✕</span>{m.session_manager_btn_delete()}
        </button>
      </div>
      <div class="footer-right">
        <button
          class="foot-btn"
          onclick={doTest}
          disabled={testing || !r.host.trim()}
        >
          {testing ? m.session_manager_testing() : m.session_manager_btn_test()}
        </button>
        <button
          class="foot-btn open-btn"
          onclick={openSession}
          disabled={connecting || !r.host.trim()}
        >
          {connecting ? m.session_manager_btn_connecting() : m.session_manager_btn_open()}
        </button>
        <button class="foot-btn cancel-btn" onclick={onclose}>{m.session_manager_btn_cancel()}</button>
      </div>
    </div>
  </div>
</div>

{#if confirmDelete}
  {@const c = confirmDelete}
  <ConfirmDialog
    title={m.session_manager_delete_title()}
    message={m.session_manager_delete_message({ label: c.label })}
    confirmLabel={m.session_manager_btn_delete()}
    danger
    onconfirm={() => {
      r.remove(c.id);
      if (selectedId === c.id) { selectedId = null; r.clearForm(); }
      confirmDelete = null;
    }}
    oncancel={() => (confirmDelete = null)}
  />
{/if}

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
    width: 55rem;
    height: 35rem;
    max-width: calc(100vw - 1.5rem);
    max-height: calc(100vh - 1.5rem);
    background: var(--bg);
    border: 1px solid var(--muted);
    border-radius: 0.375rem;
    box-shadow: 0 14px 48px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    height: 2.125rem;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 0 0.75rem;
    flex: none;
  }
  .header-title {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--fg);
  }
  .close-btn {
    margin-left: auto;
    width: 1.875rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 0.1875rem;
    color: var(--gray-55);
    padding: 0;
  }
  .close-btn:hover {
    background: var(--danger);
    color: var(--panel);
  }

  /* ── Body ── */
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* ── Left column: session list ── */
  .left-col {
    width: 20.625rem;
    flex: none;
    border-right: 1px solid var(--gray-cf);
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: 0.375rem;
    padding: 0.5rem;
    align-items: center;
    flex: none;
  }
  .filter-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    padding: 0 0.375rem;
    background: var(--panel);
    gap: 0.25rem;
  }
  .filter-icon { flex: none; }
  .filter-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 0.75rem;
    background: transparent;
    color: var(--fg);
    min-width: 0;
  }
  .filter-input::placeholder { color: var(--gray-aa); }
  .filter-clear {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    background: var(--panel);
    color: var(--danger-mute);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 0.6875rem;
    flex: none;
  }
  .filter-clear:hover { background: var(--error-bg); }

  /* ── Session list rows ── */
  .list-header {
    display: flex;
    padding: 0 0.5rem 0.25rem;
    color: var(--gray-77);
    font-size: 0.6875rem;
    flex: none;
  }
  .col-name { flex: 1; }
  .col-last { width: 5.625rem; }

  .session-list {
    flex: 1;
    overflow: auto;
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3125rem 0.5rem;
    cursor: default;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--bg);
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
  .session-last { width: 5.625rem; color: var(--muted); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-empty { padding: 1rem 0.5rem; color: var(--muted); font-size: 0.75rem; }

  /* ── Right column: connection form ── */
  .right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    min-width: 0;
    padding: 1rem 1.125rem;
    overflow: auto;
  }

  /* ── General / SSH Tunnel tabs ── */
  .view-toggle { display: flex; align-items: center; gap: 0.0625rem; margin-bottom: 0.75rem; }
  .toggle-btn {
    display: flex; align-items: center; height: 1.375rem; padding: 0 0.75rem;
    font-size: 0.75rem; border: 1px solid var(--gray-c4); background: var(--bg);
    cursor: pointer; color: var(--gray-44); border-radius: 0.125rem;
  }
  .toggle-btn:hover { background: var(--cell-border); }
  .toggle-active {
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--toggle-on-ring);
    color: var(--tab-active-fg);
  }

  /* ── Form grid & inputs ── */
  .form-grid {
    display: grid;
    grid-template-columns: 8.75rem 1fr;
    gap: 0.625rem 0.75rem;
    align-items: center;
    max-width: 27.5rem;
  }

  .form-label {
    color: var(--gray-44);
    font-size: 0.75rem;
    text-align: right;
  }

  .form-input {
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: 0.125rem;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    background: var(--panel);
    color: var(--fg);
    font-family: inherit;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .form-input:focus { border-color: var(--focus-ring); }
  .form-input.mono { font-family: var(--mono); }
  .form-input.short { width: 5.625rem; }
  .form-input:disabled { background: var(--zebra); color: var(--gray-99); cursor: default; }

  .form-check { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--fg); }
  .import-row { display: flex; gap: 0.375rem; }
  .import-row .form-input { flex: 1; }
  .import-btn {
    height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.125rem;
    background: var(--panel); cursor: pointer; font-size: 0.75rem; color: var(--fg); flex: none;
  }
  .import-btn:hover { background: var(--bg); }

  .form-error {
    margin-top: 0.625rem;
    color: var(--error);
    font-size: 0.75rem;
  }
  .form-notice {
    margin-top: 0.625rem;
    padding: 0.375rem 0.5rem;
    background: var(--warn-bg);
    border: 1px solid var(--warn);
    border-radius: 0.1875rem;
    color: var(--fg);
    font-size: 0.75rem;
  }
  /* ── Footer ── */
  .footer {
    display: flex;
    align-items: center;
    height: 2.875rem;
    flex: none;
    border-top: 1px solid var(--gray-cf);
    padding: 0 0.625rem;
    gap: 0.5rem;
    background: var(--bg);
  }
  .footer-left { display: flex; gap: 0.3125rem; align-items: center; }
  .footer-right { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }

  /* ── Footer buttons ── */
  .foot-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.625rem;
    padding: 0 0.75rem;
    background: var(--panel);
    border: 1px solid var(--gray-b8);
    border-radius: 0.1875rem;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--fg);
    font-family: inherit;
  }
  .foot-btn:hover:not(:disabled) { background: var(--bg); }
  .foot-btn:disabled { opacity: 0.5; cursor: default; }

  .new-btn .plus { color: var(--accent); font-weight: 700; }
  .new-btn:hover:not(:disabled) { background: var(--ok-bg-tint); }

  .del-btn .del-x { color: var(--danger-mute); }
  .del-btn:hover:not(:disabled) { background: var(--error-bg); }

  .open-btn {
    height: 1.75rem;
    padding: 0 1.375rem;
    background: var(--accent);
    color: var(--panel);
    border-color: transparent;
    font-weight: 600;
  }
  .open-btn:hover:not(:disabled) { background: var(--run-hover); }
  .open-btn:disabled { background: var(--ok-mid); cursor: default; opacity: 1; }

  .cancel-btn { height: 1.75rem; padding: 0 1.375rem; }
  .cancel-btn:hover { background: var(--bg); }
</style>
