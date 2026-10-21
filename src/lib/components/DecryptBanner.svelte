<script lang="ts">
  import { onMount } from "svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { decryptStatus } from "../stores/csfle.svelte";
  import { decryptReasonKey } from "../domain/csfle";
  import * as m from "#lib/paraglide/messages.js";
  import { msgKey } from "#lib/msgkey.js";

  /** Shown when a read could not decrypt and fell back to ciphertext (a key is gone, the KMS is unreachable...). */
  onMount(() => decryptStatus.start());
  const sid = $derived(sessionManager.active?.id ?? "");
  const reason = $derived(decryptStatus.reasonFor(sid));
</script>

{#if reason}
  <div class="banner" role="alert" data-testid="decrypt-banner">
    <span>{m.csfle_decrypt_unavailable({ reason: msgKey(decryptReasonKey(reason)) })}</span>
    <button type="button" onclick={() => decryptStatus.dismiss(sid)} aria-label={m.common_close()}>✕</button>
  </div>
{/if}

<style>
  .banner { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.25rem 0.625rem; background: var(--warn-bg); color: var(--fg); border-bottom: 1px solid var(--border); font-size: var(--fs); }
  button { border: none; background: none; cursor: pointer; color: var(--muted); }
</style>
