<script lang="ts">
  import { pickCertFile as chooseCertFile, pickAnyFile, forgetHostKey } from "../stores/desktop";
  import * as m from "#lib/paraglide/messages.js";
  import type { createConnectionRegistry } from "../stores/connections.svelte";
  import { ENV_META, suggestEnvironment, type Environment } from "../domain/environment";
  import { SESSION_COLORS } from "../domain/session";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import { csfle } from "../stores/csfle.svelte";
  import CsfleSettings from "./CsfleSettings.svelte";

  let {
    registry: r,
    connectError,
  }: {
    registry: ReturnType<typeof createConnectionRegistry>;
    connectError: string | null;
  } = $props();

  let uriText = $state("");
  let uriError = $state(false);
  let filled = $state<number | null>(null);
  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));
  let activeTab = $state<"general" | "ssh" | "proxy" | "encryption">("general");
  // The Encryption tab exists only where this build links libmongocrypt.
  let csfleOn = $state(false);
  csfle.available().then((v) => (csfleOn = v)).catch(() => {});
  let forgettingHostKey = $state(false);
  let forgotHostKey = $state(false);

  const ENVS: Environment[] = ["", "dev", "staging", "prod"];
  const SWATCHES = SESSION_COLORS.slice(0, 6);
  // Once the user picks an environment themselves, stop suggesting one.
  let envPicked = $state(false);
  const suggestion = $derived(!envPicked && r.environment === "" ? suggestEnvironment(r.label, r.host) : null);
  const suggestText = (e: Environment) =>
    e === "prod" ? m.env_suggest_prod() : e === "staging" ? m.env_suggest_staging() : m.env_suggest_dev();

  // Another connection in the form: suggestions apply again.
  $effect(() => {
    void r.editingId;
    envPicked = false;
  });

  function pickEnv(e: Environment) {
    envPicked = true;
    r.environment = e;
  }

  async function pickCertFile() {
    const path = await chooseCertFile();
    if (path) r.tlsCertificateKeyFile = path;
  }
  async function pickSshKeyFile() {
    const path = await pickAnyFile();
    if (path) r.sshPrivateKeyPath = path;
  }
  async function doForgetSshHostKey() {
    forgettingHostKey = true;
    forgotHostKey = false;
    try {
      await forgetHostKey(r.sshHost, r.sshPort ?? 22);
      forgotHostKey = true;
    } finally {
      forgettingHostKey = false;
    }
  }

  function applyUri(text: string) {
    if (!text.trim()) return;
    const res = r.fillFromUri(text);
    uriError = !res.ok;
    filled = res.ok ? res.filled : null;
    if (res.ok) uriText = "";
  }
  function onUriPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text.trim()) return;
    e.preventDefault();
    applyUri(text);
  }
  function undoFill() {
    r.undoFill();
    filled = null;
  }
  async function copyUri(withPassword: boolean) {
    await copy(r.formUri(withPassword));
    toast.push(m.conn_uri_copied());
  }
</script>

<!-- Where a saved password goes; sits in the second grid column under the field. -->
{#snippet secretNote()}
  {#if r.secretStorage}
    <span></span>
    <span class="secret-note" class:warn={r.secretStorage === "file"}>
      {r.secretStorage === "keychain" ? m.conn_secret_keychain() : m.conn_secret_file()}
    </span>
  {/if}
{/snippet}

<div class="right-col">
  <div class="view-toggle">
    <button type="button" class="toggle-btn" class:toggle-active={activeTab === "general"} onclick={() => (activeTab = "general")}>
      {m.session_manager_tab_general()}
    </button>
    <button type="button" class="toggle-btn" class:toggle-active={activeTab === "ssh"} onclick={() => (activeTab = "ssh")}>
      {m.session_manager_tab_ssh()}
    </button>
    <button type="button" class="toggle-btn" class:toggle-active={activeTab === "proxy"} onclick={() => (activeTab = "proxy")}>
      {m.session_manager_tab_proxy()}
    </button>
    {#if csfleOn}
      <button type="button" class="toggle-btn" class:toggle-active={activeTab === "encryption"} onclick={() => (activeTab = "encryption")}>
        {m.csfle_tab()}
      </button>
    {/if}
  </div>

  {#if activeTab === "general"}
    <div class="form-grid">
      <span class="form-label">{m.conn_uri_label()}:</span>
      <div class="uri-cell">
        <input
          id="conn-uri-input"
          class="form-input mono"
          bind:value={uriText}
          placeholder={m.conn_uri_placeholder()}
          aria-label={m.conn_uri_label()}
          aria-invalid={uriError}
          onpaste={onUriPaste}
          oninput={() => (uriError = false)}
          onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyUri(uriText); } }}
          onchange={() => applyUri(uriText)}
          spellcheck="false"
          autocomplete="off"
        />
        {#if uriError}<span class="uri-error">{m.conn_uri_invalid()}</span>{/if}
        {#if filled !== null && r.canUndoFill}
          <span class="uri-note">{m.conn_uri_filled({ count: String(filled) })} · <button type="button" class="hint-btn" onclick={undoFill}>{m.conn_uri_undo()}</button></span>
        {/if}
        {#if r.editingId !== null}
          <span class="uri-copy">
            <button type="button" class="hint-btn" onclick={() => copyUri(false)}>{m.conn_copy_uri()}</button>
            {#if r.password}<button type="button" class="hint-btn" onclick={() => copyUri(true)}>{m.conn_copy_uri_password()}</button>{/if}
          </span>
        {/if}
      </div>

      <span class="form-label">{m.session_manager_label_session_name()}</span>
      <input class="form-input" bind:value={r.label} placeholder={m.connection_form_name_placeholder()} aria-label={m.session_manager_col_name()} />

      <span class="form-label">{m.env_label()}:</span>
      <div class="env-cell">
        <div class="segmented" role="radiogroup" aria-label={m.env_label()}>
          {#each ENVS as e (e)}
            <button
              type="button"
              role="radio"
              aria-checked={r.environment === e}
              class="seg {ENV_META[e].tone ?? ''}"
              class:on={r.environment === e}
              data-env={e || "none"}
              onclick={() => pickEnv(e)}
            >{e === "" ? m.env_none() : e === "staging" ? "STAGING" : ENV_META[e].short}</button>
          {/each}
        </div>
        {#if suggestion}
          <button type="button" class="hint-btn" onclick={() => pickEnv(suggestion)}>{suggestText(suggestion)}</button>
        {/if}
        {#if r.environment === "prod" && !r.readOnly}
          <span class="hint">{m.env_prod_readonly_hint()}</span>
        {/if}
      </div>

      <span class="form-label">{m.conn_mcp_access()}:</span>
      <div class="env-cell">
        <select class="form-input" bind:value={r.mcpAccess} aria-label={m.conn_mcp_access()}>
          <option value="off">{m.conn_mcp_access_off()}</option>
          <option value="read">{m.conn_mcp_access_read()}</option>
          <option value="write" disabled={r.environment === "prod"}>{m.conn_mcp_access_write()}</option>
        </select>
        {#if r.environment === "prod"}<span class="hint">{m.conn_mcp_access_prod_hint()}</span>{/if}
      </div>

      <span class="form-label">{m.color_label()}:</span>
      <div class="swatches" role="radiogroup" aria-label={m.color_label()}>
        <button type="button" role="radio" class="swatch auto" class:on={r.color === ""} aria-checked={r.color === ""} aria-label={m.color_auto()} title={m.color_auto()} onclick={() => (r.color = "")}>A</button>
        {#each SWATCHES as c (c)}
          <button type="button" role="radio" class="swatch" class:on={r.color === c} aria-checked={r.color === c} aria-label={c} style="background:{c}" onclick={() => (r.color = c)}></button>
        {/each}
      </div>

      <span class="form-label">{m.session_manager_label_conn_type()}</span>
      <select class="form-input" bind:value={r.scheme} aria-label={m.session_manager_label_conn_type()}>
        <option value="mongodb">{m.session_manager_conn_direct()}</option>
        {#if !r.sshEnabled && r.proxyType !== "http"}
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
        <option value="aws">{m.session_manager_auth_aws()}</option>
        <option value="kerberos">{m.session_manager_auth_kerberos()}</option>
        <option value="oidc">{m.session_manager_auth_oidc()}</option>
      </select>

      {#if r.authMethod === "aws"}
        <span class="form-label"></span>
        <div class="form-notice">{m.conn_aws_hint()}</div>

        <span class="form-label">{m.conn_aws_access_key()}</span>
        <input class="form-input mono" bind:value={r.user} autocomplete="off" aria-label={m.conn_aws_access_key()} />

        <span class="form-label">{m.conn_aws_secret_key()}</span>
        <input class="form-input" type="password" bind:value={r.password} autocomplete="off" aria-label={m.conn_aws_secret_key()} />

        <span class="form-label">{m.conn_aws_session_token()}</span>
        <input class="form-input" type="password" bind:value={r.awsSessionToken} autocomplete="off" aria-label={m.conn_aws_session_token()} />
        {@render secretNote()}
      {:else if r.authMethod === "oidc"}
        <span class="form-label">{m.conn_oidc_mode()}</span>
        <select class="form-input" bind:value={r.oidcMode} aria-label={m.conn_oidc_mode()}>
          <option value="workforce">{m.conn_oidc_mode_workforce()}</option>
          <option value="workload">{m.conn_oidc_mode_workload()}</option>
        </select>

        <span class="form-label"></span>
        <div class="form-notice">{r.oidcMode === "workload" ? m.conn_oidc_hint_workload() : m.conn_oidc_hint_workforce()}</div>

        {#if r.oidcMode === "workload"}
          <span class="form-label">{m.conn_oidc_environment()}</span>
          <select class="form-input" bind:value={r.oidcEnvironment} aria-label={m.conn_oidc_environment()}>
            <option value="azure">{m.conn_oidc_env_azure()}</option>
            <option value="gcp">{m.conn_oidc_env_gcp()}</option>
            <option value="k8s">{m.conn_oidc_env_k8s()}</option>
          </select>

          {#if r.oidcEnvironment === "azure"}
            <span class="form-label">{m.conn_oidc_azure_client_id()}</span>
            <input class="form-input mono" bind:value={r.user} autocomplete="off" aria-label={m.conn_oidc_azure_client_id()} />
          {/if}
          {#if r.oidcEnvironment !== "k8s"}
            <span class="form-label">{m.conn_oidc_token_resource()}</span>
            <input class="form-input mono" bind:value={r.oidcTokenResource} autocomplete="off" aria-label={m.conn_oidc_token_resource()} />
          {/if}
        {:else}
          <span class="form-label">{m.conn_oidc_username_hint()}</span>
          <input class="form-input" bind:value={r.user} autocomplete="off" aria-label={m.conn_oidc_username_hint()} />
        {/if}
      {:else if r.authMethod === "kerberos"}
        <span class="form-label"></span>
        <div class="form-notice">{m.conn_kerberos_hint()}</div>

        <span class="form-label">{m.conn_kerberos_principal()}</span>
        <input class="form-input mono" bind:value={r.user} placeholder="user@EXAMPLE.COM" autocomplete="off" aria-label={m.conn_kerberos_principal()} />

        <span class="form-label">{m.conn_kerberos_service_name()}</span>
        <input class="form-input mono" bind:value={r.gssapiServiceName} placeholder="mongodb" aria-label={m.conn_kerberos_service_name()} />

        <span class="form-label">{m.conn_kerberos_service_realm()}</span>
        <input class="form-input mono" bind:value={r.gssapiServiceRealm} placeholder={m.connection_form_optional()} aria-label={m.conn_kerberos_service_realm()} />

        <span class="form-label">{m.conn_kerberos_canonicalize()}</span>
        <select class="form-input" bind:value={r.gssapiCanonicalize} aria-label={m.conn_kerberos_canonicalize()}>
          <option value="">{m.conn_kerberos_canon_default()}</option>
          <option value="none">none</option>
          <option value="forward">forward</option>
          <option value="forwardAndReverse">forwardAndReverse</option>
        </select>
      {:else if r.authMethod !== "x509"}
        <span class="form-label">{m.session_manager_label_user()}</span>
        <input class="form-input" bind:value={r.user} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_user()} />

        <span class="form-label">{m.session_manager_label_password()}</span>
        <input class="form-input" type="password" bind:value={r.password} disabled={r.authMethod === "none"} aria-label={m.session_manager_label_password()} />
        {#if r.authMethod !== "none"}{@render secretNote()}{/if}
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
        value={r.authMethod === "ldap" || r.authMethod === "aws" || r.authMethod === "kerberos" || r.authMethod === "oidc" ? "$external" : r.authSource}
        oninput={(e) => { r.authSource = e.currentTarget.value; }}
        disabled={r.authMethod === "x509" || r.authMethod === "ldap" || r.authMethod === "aws" || r.authMethod === "kerberos" || r.authMethod === "oidc"}
        placeholder="admin"
        aria-label={m.session_manager_label_auth_db()}
      />

      <span class="form-label">{m.session_manager_label_replica_set()}</span>
      <input class="form-input mono" bind:value={r.replicaSet} disabled={r.tunneled} title={r.tunneled ? m.session_manager_tooltip_ssh_lock() : undefined} placeholder={m.connection_form_optional()} aria-label={m.session_manager_label_replica_set()} />

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

      {#if (r.tls || r.authMethod === "x509" || r.authMethod === "ldap") && r.tunneled}
        <span class="form-label"></span>
        <div class="form-notice" data-testid="tls-tunnel-hint">{m.conn_tls_tunnel_hostname_hint()}</div>
      {/if}

      <span class="form-label">{m.session_manager_label_readonly()}</span>
      <label class="form-check">
        <input type="checkbox" bind:checked={r.readOnly} aria-label={m.session_manager_label_readonly()} />
        <span>{m.session_manager_readonly_enable()}</span>
      </label>

      <span class="form-label">{m.session_manager_label_extra()}</span>
      <input class="form-input mono" bind:value={r.extraOptions} placeholder="readPreference=secondary&appName=x" aria-label={m.session_manager_label_extra()} />
    </div>
  {:else if activeTab === "proxy"}
    <div class="form-grid">
      <span class="form-label">{m.session_manager_proxy_type()}</span>
      <select class="form-input" bind:value={r.proxyType} aria-label={m.session_manager_proxy_type()}>
        <option value="none">{m.session_manager_proxy_none()}</option>
        <option value="socks5">SOCKS5</option>
        <option value="http">{m.session_manager_proxy_http()}</option>
      </select>

      {#if r.proxyType !== "none"}
        <span class="form-label"></span>
        <div class="form-notice">{r.proxyType === "http" ? m.session_manager_proxy_http_notice() : m.session_manager_proxy_socks_notice()}</div>
        {#if r.sshEnabled}
          <span class="form-label"></span>
          <div class="form-error">{m.session_manager_proxy_ssh_conflict()}</div>
        {/if}

        <span class="form-label">{m.session_manager_label_proxy_host()}</span>
        <input class="form-input mono" bind:value={r.proxyHost} aria-label={m.session_manager_label_proxy_host()} />

        <span class="form-label">{m.session_manager_label_proxy_port()}</span>
        <input class="form-input mono short" type="number" bind:value={r.proxyPort} placeholder={r.proxyType === "http" ? "3128" : "1080"} aria-label={m.session_manager_label_proxy_port()} />

        <span class="form-label">{m.session_manager_label_proxy_user()}</span>
        <input class="form-input" bind:value={r.proxyUser} placeholder={m.connection_form_optional()} autocomplete="off" aria-label={m.session_manager_label_proxy_user()} />

        <span class="form-label">{m.session_manager_label_proxy_password()}</span>
        <input class="form-input" type="password" bind:value={r.proxyPassword} autocomplete="off" aria-label={m.session_manager_label_proxy_password()} />
        {@render secretNote()}
      {/if}
    </div>
  {:else if activeTab === "encryption"}
    {#key r.editingId}
      <CsfleSettings connectionId={r.editingId} />
    {/key}
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
          {@render secretNote()}
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
  {#if r.offerSaveWithoutPassword}
    <div class="form-error"><button type="button" class="hint-btn" onclick={r.saveWithoutPassword}>{m.vault_save_without_password()}</button></div>
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
    background: transparent;
    min-width: 0;
    padding: 0 1.5rem 1.25rem;
    overflow: auto;
  }

  /* ── General / SSH Tunnel tabs ── */
  /* Underline tabs, sticky so they stay reachable while a long form scrolls. */
  .view-toggle {
    display: flex; align-items: center; gap: 1.125rem; margin: 0 0 1.125rem;
    border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 1;
    background: var(--popover); padding-top: 0.75rem;
  }
  .toggle-btn {
    display: flex; align-items: center; height: 2.125rem; padding: 0;
    font-size: var(--fs); border: none; background: none;
    cursor: pointer; color: var(--muted); border-radius: 0;
  }
  .toggle-btn:hover { color: var(--fg); }
  .toggle-active {
    color: var(--fg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  /* ── Form grid & inputs ── */
  .form-grid {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 0.625rem 1rem;
    align-items: center;
    max-width: 32rem;
  }

  .form-label {
    color: var(--muted);
    font-size: var(--fs);
    text-align: left;
  }

  .form-input {
    height: 2rem;
    border: 1px solid var(--c-surface1);
    border-radius: var(--radius);
    padding: 0 0.625rem;
    font-size: var(--fs);
    background: var(--bg);
    color: var(--fg);
    font-family: inherit;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .form-input.mono { font-family: var(--mono); }
  .form-input.short { width: 6.5rem; }
  .form-input:disabled { background: var(--hover); color: var(--muted); cursor: default; }

  .env-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 0.375rem; }
  .segmented { display: inline-flex; padding: 0.125rem; gap: 0.125rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); }
  .seg {
    height: 1.5rem; padding: 0 0.625rem; border: none; border-radius: var(--radius-sm); background: none;
    color: var(--muted); font-size: 0.75rem; font-weight: 500; cursor: pointer;
  }
  .seg:hover { color: var(--fg); }
  .seg.on { background: var(--menu-hover); color: var(--fg); box-shadow: 0 0 0 1px var(--c-surface1); }
  .seg.on.ok { background: var(--ok-bg); color: var(--ok-fg); }
  .seg.on.warn { background: var(--warn-bg); color: var(--warn-fg); }
  .seg.on.danger { background: var(--error-bg); color: var(--danger); }
  .hint-btn { border: none; background: none; padding: 0; color: var(--link); font-size: 0.75rem; cursor: pointer; }
  .hint-btn:hover { text-decoration: underline; }
  .hint { color: var(--warn-fg); font-size: 0.75rem; }
  .secret-note { margin-top: -0.25rem; color: var(--muted); font-size: 0.71875rem; }
  .secret-note.warn { color: var(--warn-fg); }
  .swatches { display: flex; gap: 0.375rem; align-items: center; }
  .swatch {
    width: 1.25rem; height: 1.25rem; padding: 0; border-radius: 50%; border: none; cursor: pointer;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 15%, transparent);
  }
  .swatch.auto { background: var(--bg); color: var(--muted); font-size: 0.625rem; font-weight: 600; box-shadow: inset 0 0 0 1px var(--c-surface1); }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .uri-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3125rem; }
  .uri-error { color: var(--error); font-size: 0.75rem; }
  .uri-note { color: var(--muted); font-size: 0.75rem; }
  .uri-copy { display: flex; gap: 0.875rem; }
  .form-check { display: flex; align-items: center; gap: 0.375rem; font-size: var(--fs); color: var(--fg); }
  .import-row { display: flex; gap: 0.375rem; }
  .import-row .form-input { flex: 1; }
  .import-btn {
    height: 2rem; padding: 0 0.75rem; border: 1px solid var(--c-surface1); border-radius: var(--radius);
    background: var(--hover); cursor: pointer; font-size: var(--fs); color: var(--fg); flex: none;
  }
  .import-btn:hover { background: var(--menu-hover); }
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
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: var(--fs);
  }
</style>
