<!-- Staged cell edits for the open collection: count, Commit, and Discard (asks first). -->
<script lang="ts">
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { count, committing, oncommit, ondiscard }: {
    count: number;
    committing: boolean;
    oncommit: () => void;
    ondiscard: () => void;
  } = $props();

  let confirmDiscard = $state(false);
</script>

<div class="pending-bar" role="status">
  <span class="dot" aria-hidden="true"></span>
  <span class="label">{msgCount("pending_count", count)}</span>
  <button onclick={() => (confirmDiscard = true)} disabled={committing}>{m.pending_discard()}</button>
  <button class="primary" onclick={oncommit} disabled={committing}>
    {#if committing}<span class="spinner" aria-hidden="true"></span>{/if}{m.pending_commit()}
  </button>
</div>

{#if confirmDiscard}
  <ConfirmDialog
    title={m.pending_discard_title()}
    message={msgCount("pending_discard_message", count)}
    confirmLabel={m.pending_discard()}
    danger
    onconfirm={() => { confirmDiscard = false; ondiscard(); }}
    oncancel={() => (confirmDiscard = false)}
  />
{/if}

<style>
  .pending-bar {
    display: flex; align-items: center; gap: 0.5rem; flex: none; padding: 0.3125rem 0.625rem;
    background: var(--warn-bg2); color: var(--warn-fg); font-size: var(--fs); border-bottom: 1px solid var(--border);
  }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; flex: none; }
  .label { margin-right: auto; font-weight: 500; }
  button {
    height: 1.625rem; display: inline-flex; align-items: center; gap: 0.375rem; padding: 0 0.75rem;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg);
    font-size: var(--fs); cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: default; }
  .primary { background: var(--run); color: var(--on-accent); border-color: transparent; font-weight: 600; }
  .primary:hover:not(:disabled) { background: var(--run-hover); }
  .spinner {
    width: 0.6875rem; height: 0.6875rem; border: 2px solid currentColor; border-right-color: transparent;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
