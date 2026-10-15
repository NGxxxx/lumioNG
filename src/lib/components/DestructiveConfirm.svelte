<script lang="ts">
  import Modal from "./Modal.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { ops, prod = false, onrun, oncancel, ondontask }:
    { ops: string[]; /** PROD session: no "Don't ask again", and the dialog says where it runs. */ prod?: boolean; onrun: () => void; oncancel: () => void; ondontask: () => void } = $props();
</script>

<Modal title={m.destructive_confirm_title()} ondismiss={oncancel} onenter={onrun}>
  {#snippet body()}
    <p>{m.destructive_confirm_body({ ops: ops.join(", ") })}</p>
    {#if prod}<p class="prod">{m.destructive_on_prod()}</p>{/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel}>{m.common_cancel()}</button>
    {#if !prod}<button onclick={ondontask}>{m.destructive_confirm_dont_ask()}</button>{/if}
    <button class="danger" onclick={onrun}>{m.destructive_confirm_run()}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0; word-break: break-word; }
  .prod { margin-top: 0.5rem; color: var(--danger); font-weight: 500; }
</style>
