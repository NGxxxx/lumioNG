<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { pushModal } from "$lib/stores/modalStack";
  import * as m from "$lib/paraglide/messages";

  let { ops, onrun, oncancel, ondontask }:
    { ops: string[]; onrun: () => void; oncancel: () => void; ondontask: () => void } = $props();

  onMount(() => pushModal({ onEscape: oncancel, onEnter: onrun }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) oncancel(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.destructive_confirm_title()}>
    <header>{m.destructive_confirm_title()}</header>
    <div class="body">
      <p>{m.destructive_confirm_body({ ops: ops.join(", ") })}</p>
    </div>
    <footer>
      <button onclick={oncancel}>{m.common_cancel()}</button>
      <button onclick={ondontask}>{m.destructive_confirm_dont_ask()}</button>
      <button class="danger" onclick={onrun}>{m.destructive_confirm_run()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .body p { margin: 0; word-break: break-word; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  .danger { color: var(--error); }
</style>
