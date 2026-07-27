<script lang="ts">
  import Modal from "./Modal.svelte";
  import * as m from "$lib/paraglide/messages";

  let { ops, onrun, oncancel, ondontask }:
    { ops: string[]; onrun: () => void; oncancel: () => void; ondontask: () => void } = $props();
</script>

<Modal title={m.destructive_confirm_title()} ondismiss={oncancel} onenter={onrun}>
  {#snippet body()}
    <p>{m.destructive_confirm_body({ ops: ops.join(", ") })}</p>
  {/snippet}
  {#snippet footer()}
    <button onclick={oncancel}>{m.common_cancel()}</button>
    <button onclick={ondontask}>{m.destructive_confirm_dont_ask()}</button>
    <button class="danger" onclick={onrun}>{m.destructive_confirm_run()}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0; word-break: break-word; }
</style>
