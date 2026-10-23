<script lang="ts">
  import { untrack } from "svelte";
  import { createCsfleSettings } from "../stores/csfleSettings.svelte";
  import { pickAnyFile, pickSavePath } from "../stores/desktop";
  import { KMS_PROVIDERS } from "../domain/csfle";
  import * as m from "#lib/paraglide/messages.js";
  import { msgKey } from "#lib/msgkey.js";

  /** The "Encryption" tab of a saved connection: key vault, KMS providers and credentials. Credentials are write-only. */
  let { connectionId }: { connectionId: number | null } = $props();

  const s = untrack(() => createCsfleSettings(connectionId));
  untrack(() => s.load());

  async function chooseFile(set: (path: string) => void) {
    const path = await pickAnyFile();
    if (path) set(path);
  }
  async function generate() {
    const path = await pickSavePath("lumiong-local-master.key", "key");
    if (path) await s.generateLocalKey(path);
  }
  const problemText = $derived(s.problem ? msgKey(`csfle_problem_${s.problem}`) : null);
</script>

{#if connectionId === null}
  <div class="note">{m.csfle_save_first()}</div>
{:else}
  <div class="note">{m.csfle_intro()}</div>
  <div class="form-grid">
    <span class="lbl">{m.csfle_enable()}</span>
    <label class="check"><input type="checkbox" bind:checked={s.enabled} aria-label={m.csfle_enable()} /><span>{m.csfle_enable_hint()}</span></label>

    <span class="lbl">{m.csfle_key_vault()}</span>
    <input class="inp mono" bind:value={s.namespace} placeholder="encryption.__keyVault" aria-label={m.csfle_key_vault()} />

    <span class="lbl">{m.csfle_providers()}</span>
    <div class="providers">
      {#each KMS_PROVIDERS as p (p)}
        <label class="check">
          <input type="checkbox" checked={s.selected.includes(p)} onchange={(e) => s.toggleProvider(p, e.currentTarget.checked)} aria-label={msgKey(`csfle_provider_${p}`)} />
          <span>{msgKey(`csfle_provider_${p}`)}</span>
          {#if s.stored.includes(p)}<span class="stored">{m.csfle_stored()}</span>{/if}
        </label>
      {/each}
    </div>
  </div>

  {#each KMS_PROVIDERS.filter((p) => s.selected.includes(p)) as p (p)}
    <fieldset>
      <legend>{msgKey(`csfle_provider_${p}`)}</legend>
      <div class="form-grid">
        {#if p === "local"}
          <span class="lbl">{m.csfle_local_key_file()}</span>
          <div class="row">
            <input class="inp mono" bind:value={s.form.localKeyFile} placeholder={s.stored.includes("local") ? m.csfle_keep_hint() : ""} aria-label={m.csfle_local_key_file()} />
            <button type="button" class="btn" onclick={() => chooseFile((v) => (s.form.localKeyFile = v))}>{m.session_manager_btn_choose_file()}</button>
            <button type="button" class="btn" onclick={generate}>{m.csfle_local_generate()}</button>
          </div>
          <span class="lbl"></span>
          <div class="hint">{m.csfle_local_hint()}</div>
        {:else if p === "aws"}
          <span class="lbl">{m.csfle_aws_access_key_id()}</span>
          <input class="inp mono" bind:value={s.form.awsAccessKeyId} autocomplete="off" aria-label={m.csfle_aws_access_key_id()} />
          <span class="lbl">{m.csfle_aws_secret()}</span>
          <input class="inp" type="password" bind:value={s.form.awsSecretAccessKey} autocomplete="off" placeholder={s.stored.includes("aws") ? m.csfle_keep_hint() : ""} aria-label={m.csfle_aws_secret()} />
          <span class="lbl">{m.csfle_aws_session_token()}</span>
          <input class="inp" type="password" bind:value={s.form.awsSessionToken} autocomplete="off" aria-label={m.csfle_aws_session_token()} />
        {:else if p === "azure"}
          <span class="lbl">{m.csfle_azure_tenant()}</span>
          <input class="inp mono" bind:value={s.form.azureTenantId} autocomplete="off" aria-label={m.csfle_azure_tenant()} />
          <span class="lbl">{m.csfle_azure_client_id()}</span>
          <input class="inp mono" bind:value={s.form.azureClientId} autocomplete="off" aria-label={m.csfle_azure_client_id()} />
          <span class="lbl">{m.csfle_azure_client_secret()}</span>
          <input class="inp" type="password" bind:value={s.form.azureClientSecret} autocomplete="off" placeholder={s.stored.includes("azure") ? m.csfle_keep_hint() : ""} aria-label={m.csfle_azure_client_secret()} />
        {:else if p === "gcp"}
          <span class="lbl">{m.csfle_gcp_email()}</span>
          <input class="inp mono" bind:value={s.form.gcpEmail} autocomplete="off" aria-label={m.csfle_gcp_email()} />
          <span class="lbl">{m.csfle_gcp_private_key()}</span>
          <input class="inp" type="password" bind:value={s.form.gcpPrivateKey} autocomplete="off" placeholder={s.stored.includes("gcp") ? m.csfle_keep_hint() : ""} aria-label={m.csfle_gcp_private_key()} />
        {:else}
          <span class="lbl">{m.csfle_kmip_endpoint()}</span>
          <input class="inp mono" bind:value={s.form.kmipEndpoint} placeholder="kmip.example.com:5696" autocomplete="off" aria-label={m.csfle_kmip_endpoint()} />
          <span class="lbl">{m.csfle_kmip_ca()}</span>
          <div class="row">
            <input class="inp mono" bind:value={s.form.kmipCaFile} aria-label={m.csfle_kmip_ca()} />
            <button type="button" class="btn" onclick={() => chooseFile((v) => (s.form.kmipCaFile = v))}>{m.session_manager_btn_choose_file()}</button>
          </div>
          <span class="lbl">{m.csfle_kmip_client_cert()}</span>
          <div class="row">
            <input class="inp mono" bind:value={s.form.kmipClientCertFile} aria-label={m.csfle_kmip_client_cert()} />
            <button type="button" class="btn" onclick={() => chooseFile((v) => (s.form.kmipClientCertFile = v))}>{m.session_manager_btn_choose_file()}</button>
          </div>
          <span class="lbl">{m.csfle_kmip_cert_password()}</span>
          <input class="inp" type="password" bind:value={s.form.kmipCertPassword} autocomplete="off" placeholder={s.stored.includes("kmip") ? m.csfle_keep_hint() : ""} aria-label={m.csfle_kmip_cert_password()} />
        {/if}
      </div>
    </fieldset>
  {/each}

  <div class="form-grid">
    <span class="lbl">{m.csfle_crypt_shared()}</span>
    <div class="row">
      <input class="inp mono" bind:value={s.cryptSharedLibPath} placeholder={m.connection_form_optional()} aria-label={m.csfle_crypt_shared()} />
      <button type="button" class="btn" onclick={() => chooseFile((v) => (s.cryptSharedLibPath = v))}>{m.session_manager_btn_choose_file()}</button>
    </div>
    <span class="lbl"></span>
    <div class="hint">{m.csfle_crypt_shared_hint()}</div>
  </div>

  {#if problemText}<div class="hint warn">{problemText}</div>{/if}
  {#if s.error}<div class="error">{msgKey(s.error)}</div>{/if}
  {#if s.savedTo !== null && !s.error}
    <div class="hint">{s.savedTo === "keychain" ? m.csfle_saved_keychain() : s.savedTo === "vault" ? m.csfle_saved_vault() : m.csfle_saved()} {m.csfle_reconnect_hint()}</div>
  {/if}
  <div class="actions">
    <button type="button" class="btn primary" disabled={s.saving || s.loading || s.problem !== null} onclick={() => s.save()}>{m.csfle_save_btn()}</button>
  </div>
{/if}

<style>
  .note { margin: 0 0 0.75rem; padding: 0.375rem 0.5rem; background: var(--warn-bg); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); border-radius: var(--radius); color: var(--fg); font-size: var(--fs); max-width: 32rem; }
  .form-grid { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 0.625rem 1rem; align-items: center; max-width: 32rem; margin-bottom: 0.75rem; }
  .lbl { color: var(--muted); font-size: var(--fs); }
  .inp { height: 2rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); padding: 0 0.625rem; font-size: var(--fs); background: var(--bg); color: var(--fg); font-family: inherit; outline: none; width: 100%; box-sizing: border-box; }
  .inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .inp.mono { font-family: var(--mono); }
  .check { display: flex; align-items: center; gap: 0.375rem; font-size: var(--fs); color: var(--fg); }
  .providers { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; }
  .stored { color: var(--muted); font-size: 0.71875rem; }
  .row { display: flex; gap: 0.375rem; }
  .row .inp { flex: 1; }
  .btn { height: 2rem; padding: 0 0.75rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--hover); cursor: pointer; font-size: var(--fs); color: var(--fg); flex: none; }
  .btn:hover { background: var(--menu-hover); }
  .btn:disabled { color: var(--gray-99); cursor: default; }
  .hint { color: var(--muted); font-size: 0.75rem; }
  .hint.warn { color: var(--warn-fg); margin-bottom: 0.5rem; }
  .error { color: var(--error); font-size: var(--fs); margin-bottom: 0.5rem; }
  fieldset { border: 1px solid var(--c-surface1); border-radius: var(--radius); margin: 0 0 0.75rem; padding: 0.625rem 0.75rem 0; max-width: 32rem; box-sizing: border-box; }
  legend { font-size: var(--fs); color: var(--fg); padding: 0 0.25rem; }
  .actions { display: flex; gap: 0.5rem; }
</style>
