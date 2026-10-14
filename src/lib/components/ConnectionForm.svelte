<script lang="ts">
  import { openDialog } from "../api/files";
  import { forgetSshHostKey } from "../api/connection";
  import * as m from "$lib/paraglide/messages";
  import type { createConnectionRegistry } from "../stores/connections.svelte";

  let {
    registry: r,
    connectError,
  }: {
    registry: ReturnType<typeof createConnectionRegistry>;
    connectError: string | null;
  } = $props();

  let importUri = $state("");
  let activeTab = $state<"general" | "ssh">("general");
  let forgettingHostKey = $state(false);
  let forgotHostKey = $state(false);

  async function pickCertFile() {
    const path = await openDialog([{ name: "PEM", extensions: ["pem", "crt", "cer"] }]);
    if (path) r.tlsCertificateKeyFile = path;
  }
  async function pickSshKeyFile() {
    const path = await openDialog([{ name: "All files", extensions: ["*"] }]);
    if (path) r.sshPrivateKeyPath = path;
  }
  async function doForgetSshHostKey() {
    forgettingHostKey = true;
    forgotHostKey = false;
    try {
      await forgetSshHostKey(r.sshHost, r.sshPort ?? 22);
      forgotHostKey = true;
    } finally {
      forgettingHostKey = false;
    }
  }

  function doImport() {
    if (importUri.trim()) { r.importFromUri(importUri.trim()); importUri = ""; }
  }
</script>

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

        <span class="form-label"></span>
        <div class="import-row">
          <button type="button" class="import-btn" disabled={!r.sshHost || forgettingHostKey} onclick={doForgetSshHostKey}>
            {m.session_manager_ssh_forget_host_key()}
          </button>
          {#if forgotHostKey}<span class="ssh-forget-done">{m.session_manager_ssh_forget_host_key_done()}</span>{/if}
        </div>

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

<style>
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
    font-size: var(--fs); border: 1px solid var(--gray-c4); background: var(--bg);
    cursor: pointer; color: var(--gray-44); border-radius: var(--radius-sm);
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
    font-size: var(--fs);
    text-align: right;
  }

  .form-input {
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: var(--radius-sm);
    padding: 0 0.5rem;
    font-size: var(--fs);
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

  .form-check { display: flex; align-items: center; gap: 0.375rem; font-size: var(--fs); color: var(--fg); }
  .import-row { display: flex; gap: 0.375rem; }
  .import-row .form-input { flex: 1; }
  .import-btn {
    height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius-sm);
    background: var(--panel); cursor: pointer; font-size: var(--fs); color: var(--fg); flex: none;
  }
  .import-btn:hover { background: var(--bg); }
  .import-btn:disabled { color: var(--gray-99); cursor: default; }
  .ssh-forget-done { font-size: var(--fs); color: var(--fg); align-self: center; }

  .form-error {
    margin-top: 0.625rem;
    color: var(--error);
    font-size: var(--fs);
  }
  .form-notice {
    margin-top: 0.625rem;
    padding: 0.375rem 0.5rem;
    background: var(--warn-bg);
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: var(--fs);
  }
</style>
