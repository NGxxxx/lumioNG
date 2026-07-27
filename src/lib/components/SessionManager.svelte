<script lang="ts">
  import { onMount } from "svelte";
  import { pushModal } from "$lib/stores/modalStack";
  import { backdropClose } from "../actions/backdropClose";
  import { createConnectionRegistry } from "../stores/connections.svelte";
  import type { SavedConnection } from "../api/connections";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import TestConnectionDialog from "./TestConnectionDialog.svelte";
  import SessionList from "./SessionList.svelte";
  import ConnectionForm from "./ConnectionForm.svelte";
  import * as m from "$lib/paraglide/messages";

  let {
    onconnected,
    onclose,
  }: {
    onconnected: (c: { connId: number | null; label: string; uri: string; readOnly: boolean; ssh: import("../api/connection").SshConnectInput | null }) => Promise<boolean>;
    onclose: () => void;
  } = $props();

  const r = createConnectionRegistry();

  let selectedId = $state<number | null>(null);
  let connecting = $state(false);
  // Distinct from r.error, which is validation/CRUD errors.
  let connectError = $state<string | null>(null);
  let confirmDelete = $state<SavedConnection | null>(null);

  let testing = $state(false);
  let testResult = $state<{ ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string } | null>(null);

  async function doTest() {
    testing = true;
    testResult = null;
    try {
      testResult = await r.testConnection();
    } finally {
      testing = false;
    }
  }

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

  onMount(() => {
    r.load();
    return pushModal({ onEscape: onclose });
  });
</script>

<div
  class="overlay"
  role="presentation"
  use:backdropClose={onclose}
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
      <SessionList list={r.list} {selectedId} onselect={selectSession} onopen={openSessionRow} />
      <ConnectionForm registry={r} {connectError} />
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
    font-size: var(--fs);
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
    font-size: var(--fs);
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
