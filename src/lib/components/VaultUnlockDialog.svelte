<!-- src/lib/components/VaultUnlockDialog.svelte — master password for saved secrets when the OS has no keychain: unlock, first-time setup, and "forgot" reset. -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { vault as appVault } from "#lib/stores/vault.svelte.js";
  import { toast } from "#lib/stores/toast.svelte.js";
  import * as m from "#lib/paraglide/messages.js";

  let { store = appVault }: { store?: typeof appVault } = $props();

  let password = $state("");
  let confirm = $state("");

  // Never keep a typed password around once its dialog is gone.
  $effect(() => {
    if (store.dialog === null) { password = ""; confirm = ""; }
  });

  async function submit() {
    if (store.busy) return;
    if (store.dialog === "unlock") await store.unlock(password);
    else if (store.dialog === "setup") await store.setup(password, confirm);
  }

  async function doReset() {
    if (await store.reset()) toast.push(m.vault_reset_done());
  }
</script>

{#if store.dialog === "reset"}
  <ConfirmDialog
    title={m.vault_reset_title()}
    message={m.vault_reset_message()}
    confirmLabel={m.vault_reset_confirm()}
    danger
    onconfirm={doReset}
    oncancel={store.backToUnlock}
  />
{:else if store.dialog}
  <Modal
    title={store.dialog === "unlock" ? m.vault_unlock_title() : m.vault_setup_title()}
    width="28rem"
    stackBody
    fadeDisabled
    ondismiss={() => { if (!store.busy) store.dismiss(); }}
    onenter={submit}
    enterDisabled={() => store.busy}
  >
    {#snippet body()}
      <p class="msg">{store.dialog === "unlock" ? m.vault_unlock_message() : m.vault_setup_message()}</p>
      <label>{m.vault_password_label()}
        <!-- svelte-ignore a11y_autofocus -->
        <input type="password" bind:value={password} disabled={store.busy} autocomplete="off" autofocus />
      </label>
      {#if store.dialog === "setup"}
        <label>{m.vault_confirm_label()}
          <input type="password" bind:value={confirm} disabled={store.busy} autocomplete="off" />
        </label>
        <p class="warn">{m.vault_no_recovery()}</p>
      {/if}
      {#if store.error}<div class="dlg-error" role="alert">{store.error}</div>{/if}
      {#if store.dialog === "unlock"}
        <button type="button" class="link" onclick={store.askReset} disabled={store.busy}>{m.vault_forgot()}</button>
      {/if}
    {/snippet}
    {#snippet footer()}
      <button onclick={store.dismiss} disabled={store.busy}>{m.vault_not_now()}</button>
      <button class="primary" onclick={submit} disabled={store.busy}>
        {store.dialog === "unlock" ? m.vault_unlock_button() : m.vault_setup_button()}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .msg { margin: 0; color: var(--fg); }
  .warn { margin: 0; color: var(--muted); font-size: 0.8125rem; }
  label { display: block; }
  .link { align-self: flex-start; background: none; border: none; padding: 0; color: var(--accent, var(--fg)); text-decoration: underline; cursor: pointer; font-size: 0.8125rem; }
</style>
