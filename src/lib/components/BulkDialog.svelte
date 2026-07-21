<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { pushModal } from "$lib/stores/modalStack";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    mode,
    scope,
    appliedFilter,
    isEmpty,
    selectionCount,
    updateText = $bindable(),
    updateError,
    count,
    counting,
    running,
    result,
    error,
    canRun,
    oncount,
    onrun,
    onclose,
  }: {
    mode: "update" | "delete";
    scope: "selection" | "filter";
    appliedFilter: string;
    isEmpty: boolean;
    selectionCount: number;
    updateText: string;
    updateError: string | null;
    count: number | null;
    counting: boolean;
    running: boolean;
    result: string | null;
    error: string | null;
    canRun: boolean;
    oncount: () => void;
    onrun: () => void;
    onclose: () => void;
  } = $props();

  const heading = $derived(
    scope === "selection"
      ? mode === "update"
        ? "Update selected"
        : "Delete selected"
      : mode === "update"
        ? "Update many"
        : "Delete many",
  );

  onMount(() => pushModal({ onEscape: onclose, onEnter: onrun, enterDisabled: () => !canRun }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="modal" role="dialog" aria-modal="true">
    <header>{heading}</header>
    <div class="body">
      {#if scope === "selection"}
        <div class="row">{m.bulk_dialog_rows_selected({ count: selectionCount })}</div>
      {:else}
        <div class="row">{m.bulk_dialog_applied_filter()} <code>{appliedFilter}</code></div>
        {#if isEmpty}
          <div class="warn">
            {m.bulk_dialog_empty_warning()}
          </div>
        {/if}
      {/if}
      {#if mode === "update"}
        <label class="ulabel">{m.bulk_dialog_update_label()}
          <textarea bind:value={updateText} rows="4" placeholder={'{ "$set": { "field": value } }'}></textarea>
        </label>
        {#if updateError}<div class="err">{msgKey(updateError)}</div>{/if}
      {/if}
      {#if scope === "filter"}
        <div class="counter">
          <button onclick={oncount} disabled={counting}>{m.common_count()}</button>
          {#if count !== null}<span>{m.bulk_dialog_matched({ count })}</span>{/if}
        </div>
      {/if}
      {#if result}<div class="ok">{result}</div>{/if}
      {#if error}<div class="err">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={onclose}>{m.common_close()}</button>
      <button class="danger" disabled={!canRun} onclick={onrun}>
        {running ? m.common_running() : mode === "update" ? m.common_update() : m.common_delete()}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 30rem; max-width: 92vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; display: flex; flex-direction: column; gap: 0.625rem; }
  code { background: var(--bg); padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  .warn { background: var(--warn-bg); border: 1px solid var(--warn); padding: 0.5rem; border-radius: 0.25rem; }
  .ulabel { display: flex; flex-direction: column; gap: 0.25rem; }
  textarea { font-family: ui-monospace, monospace; font-size: var(--fs); }
  .counter { display: flex; align-items: center; gap: 0.5rem; }
  .counter button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .counter button:hover:not(:disabled) { background: var(--bg); }
  .counter button:disabled { color: var(--gray-b8); cursor: default; }
  .ok { color: var(--ok-fg); }
  .err { color: var(--error); }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  .danger { color: var(--error); }
</style>
