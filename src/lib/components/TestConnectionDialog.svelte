<!-- src/lib/components/TestConnectionDialog.svelte -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import * as m from "$lib/paraglide/messages";

  let {
    result,
    onclose,
  }: {
    result: { ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string };
    onclose: () => void;
  } = $props();
</script>

<Modal
  title={m.session_manager_test_result_title()}
  width="22rem"
  ondismiss={onclose}
  onenter={onclose}
>
  {#snippet body()}
    {#if result.ok}
      <p class="ok">{m.session_manager_test_ok()}</p>
    {:else}
      <p class="fail">
        {#if result.kind === "ssh"}
          {m.session_manager_test_fail_ssh({ message: result.message })}
        {:else if result.kind === "mongo"}
          {m.session_manager_test_fail_mongo({ message: result.message })}
        {:else}
          {result.message}
        {/if}
      </p>
    {/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={onclose}>{m.common_ok()}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0; }
  .ok { color: var(--ok-fg); }
  .fail { color: var(--error); }
</style>
