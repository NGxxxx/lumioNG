<script lang="ts">
  import { untrack } from "svelte";
  import Modal from "./Modal.svelte";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import { createDestructiveGate } from "../stores/destructiveGate.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createEncryptFlow } from "../stores/csfleEncrypt.svelte";
  import { keyLabel, KMS_PROVIDERS } from "../domain/csfle";
  import * as m from "#lib/paraglide/messages.js";
  import { msgKey } from "#lib/msgkey.js";

  /** Picks (or creates) a data key and an algorithm, and encrypts one value of the document being edited. */
  let {
    sessionId,
    fieldPath,
    value,
    onencrypted,
    oncancel,
  }: {
    sessionId: string;
    fieldPath: string;
    value: unknown;
    /** The encrypted value (BinData subtype 6 in Extended JSON), ready to replace the field. */
    onencrypted: (encrypted: unknown) => void;
    oncancel: () => void;
  } = $props();

  const flow = untrack(() => createEncryptFlow(sessionId));
  untrack(() => flow.loadKeys());

  let creating = $state(false);
  let newProvider = $state("local");
  let newAltName = $state("");
  let master = $state<Record<string, string>>({});

  const providerName: Record<string, () => string> = {
    local: () => m.csfle_provider_local(),
    aws: () => m.csfle_provider_aws(),
    azure: () => m.csfle_provider_azure(),
    gcp: () => m.csfle_provider_gcp(),
    kmip: () => m.csfle_provider_kmip(),
  };
  const MASTER_FIELDS: Record<string, { key: string; label: () => string }[]> = {
    local: [],
    aws: [{ key: "region", label: () => m.csfle_mk_region() }, { key: "key", label: () => m.csfle_mk_key_arn() }, { key: "endpoint", label: () => m.csfle_mk_endpoint() }],
    azure: [{ key: "keyVaultEndpoint", label: () => m.csfle_mk_kv_endpoint() }, { key: "keyName", label: () => m.csfle_mk_key_name() }, { key: "keyVersion", label: () => m.csfle_mk_key_version() }],
    gcp: [{ key: "projectId", label: () => m.csfle_mk_project() }, { key: "location", label: () => m.csfle_mk_location() }, { key: "keyRing", label: () => m.csfle_mk_key_ring() }, { key: "keyName", label: () => m.csfle_mk_key_name() }, { key: "keyVersion", label: () => m.csfle_mk_key_version() }],
    kmip: [{ key: "keyId", label: () => m.csfle_mk_kmip_key_id() }, { key: "endpoint", label: () => m.csfle_mk_endpoint() }],
  };

  // Creating a key writes to the key vault: PROD asks first (confirmPolicy), other environments go straight through.
  const gate = createDestructiveGate(() => sessionManager.active?.environment ?? "");
  async function create() {
    const env = sessionManager.active?.environment ?? "";
    await gate.request({ op: "createDataKey", target: { db: m.csfle_key_vault(), detail: newAltName.trim() || undefined }, skipConfirm: env !== "prod" }, async () => {
      if (await flow.createKey(newProvider, newAltName, master)) {
        creating = false;
        newAltName = "";
        master = {};
      }
    });
  }
  async function run() {
    const out = await flow.encrypt(value);
    if (out !== null) onencrypted(out);
  }
</script>

<Modal title={m.csfle_encrypt_title()} width="30rem" stackBody ondismiss={() => { if (!flow.busy) oncancel(); }}>
  {#snippet body()}
    <div class="field-line">{m.csfle_encrypt_field({ path: fieldPath })}</div>
    {#if flow.keys.length > 0 && !creating}
      <label>{m.csfle_key()}
        <select bind:value={flow.keyId} disabled={flow.busy}>
          {#each flow.keys as k (k.id)}<option value={k.id}>{keyLabel(k)}</option>{/each}
        </select>
      </label>
      <label>{m.csfle_algorithm()}
        <select bind:value={flow.algorithm} disabled={flow.busy}>
          <option value="deterministic">{m.csfle_alg_deterministic()}</option>
          <option value="random">{m.csfle_alg_random()}</option>
        </select>
      </label>
      <button type="button" class="link" onclick={() => (creating = true)}>{m.csfle_new_key()}</button>
    {:else if flow.loading}
      <div class="hint">{m.common_running()}</div>
    {:else}
      {#if flow.keys.length === 0}<div class="hint">{m.csfle_no_keys()}</div>{/if}
      <label>{m.csfle_provider()}
        <select bind:value={newProvider} disabled={flow.busy}>
          {#each KMS_PROVIDERS as p (p)}<option value={p}>{providerName[p]()}</option>{/each}
        </select>
      </label>
      <label>{m.csfle_key_alt_name()}
        <input bind:value={newAltName} disabled={flow.busy} autocomplete="off" />
      </label>
      {#each MASTER_FIELDS[newProvider] as f (f.key)}
        <label>{f.label()}
          <input value={master[f.key] ?? ""} oninput={(e) => (master = { ...master, [f.key]: e.currentTarget.value })} disabled={flow.busy} autocomplete="off" />
        </label>
      {/each}
      <div class="inline">
        <button type="button" class="primary" disabled={flow.busy} onclick={create}>{m.csfle_create_key_btn()}</button>
        {#if flow.keys.length > 0}<button type="button" onclick={() => (creating = false)} disabled={flow.busy}>{m.common_cancel()}</button>{/if}
      </div>
    {/if}
    {#if flow.error}<div class="dlg-error">{msgKey(flow.error)}</div>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel} disabled={flow.busy}>{m.common_cancel()}</button>
    <button class="primary" disabled={flow.busy || !flow.keyId || creating} onclick={run}>{m.csfle_encrypt_btn()}</button>
  {/snippet}
</Modal>
<DestructiveDialog {gate} />

<style>
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: var(--fs); }
  .field-line { font-family: var(--mono); font-size: var(--fs); color: var(--muted); word-break: break-all; }
  .hint { color: var(--muted); font-size: var(--fs); }
  .link { align-self: flex-start; border: none; background: none; padding: 0; color: var(--link); font-size: 0.75rem; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .inline { display: flex; gap: 0.5rem; }
</style>
