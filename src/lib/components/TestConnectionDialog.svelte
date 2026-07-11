<!-- src/lib/components/TestConnectionDialog.svelte -->
<script lang="ts">
  import { portal } from "../actions/portal";
  import * as m from "$lib/paraglide/messages";

  let {
    result,
    onclose,
  }: {
    result: { ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string };
    onclose: () => void;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.session_manager_test_result_title()}>
    <header>{m.session_manager_test_result_title()}</header>
    <div class="body">
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
    </div>
    <footer>
      <button onclick={onclose}>{m.common_ok()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 22rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .body p { margin: 0; }
  .ok { color: var(--run); }
  .fail { color: var(--error); }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover { background: var(--bg); }
</style>
