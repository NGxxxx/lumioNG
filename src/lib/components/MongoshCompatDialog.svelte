<!-- src/lib/components/MongoshCompatDialog.svelte — Help › mongosh compatibility: the method table generated from the script prelude (docs/MONGOSH_COMPAT.md). -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import compatDoc from "../../../docs/MONGOSH_COMPAT.md?raw";
  import * as m from "#lib/paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();
</script>

<Modal title={m.menu_mongosh_compat()} width="40rem" ondismiss={onclose} onenter={onclose}>
  {#snippet body()}
    <pre class="doc">{compatDoc}</pre>
  {/snippet}
  {#snippet footer()}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .doc {
    margin: 0;
    max-height: 60vh;
    overflow: auto;
    white-space: pre-wrap;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
  }
</style>
