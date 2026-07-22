<!-- src/lib/components/JsonPreviewDialog.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "$lib/stores/modalStack";
  import * as m from "$lib/paraglide/messages";

  let { json, onclose }: { json: string; onclose: () => void } = $props();

  onMount(() => pushModal({ onEscape: onclose, onEnter: onclose }));
</script>

<div class="backdrop" use:portal role="presentation" use:backdropClose={onclose}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.tree_node_preview_json_title()}>
    <header>{m.tree_node_preview_json_title()}</header>
    <div class="body"><pre class="json">{json}</pre></div>
    <footer>
      <button onclick={onclose}>{m.common_close()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 34rem; max-width: 90vw; max-height: 80vh; border-radius: 0.375rem; overflow: hidden; display: flex; flex-direction: column; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); flex: none; }
  .body { padding: 0.875rem; overflow: auto; min-height: 0; }
  .json {
    margin: 0; font-family: ui-monospace, monospace; font-size: var(--fs); white-space: pre-wrap;
    word-break: break-word; color: var(--gray-33);
  }
  footer { display: flex; justify-content: flex-end; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); flex: none; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover { background: var(--bg); }
</style>
