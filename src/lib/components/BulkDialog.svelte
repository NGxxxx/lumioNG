<script lang="ts">
  import Modal from "./Modal.svelte";
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
        ? m.bulk_dialog_title_update_selection()
        : m.bulk_dialog_title_delete_selection()
      : mode === "update"
        ? m.bulk_dialog_title_update_filter()
        : m.bulk_dialog_title_delete_filter(),
  );
</script>

<Modal
  title={heading}
  width="30rem"
  maxWidth="92vw"
  stackBody
  ondismiss={onclose}
  onenter={onrun}
  enterDisabled={() => !canRun}
>
  {#snippet body()}
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
  {/snippet}
  {#snippet footer()}
    <button onclick={onclose}>{m.common_close()}</button>
    <button class="danger" disabled={!canRun} onclick={onrun}>
      {running ? m.common_running() : mode === "update" ? m.common_update() : m.common_delete()}
    </button>
  {/snippet}
</Modal>

<style>
  .warn { background: var(--warn-bg); border: 1px solid var(--warn); padding: 0.5rem; border-radius: 0.25rem; }
  .ulabel { display: flex; flex-direction: column; gap: 0.25rem; }
  textarea { font-family: ui-monospace, monospace; font-size: var(--fs); }
  .counter { display: flex; align-items: center; gap: 0.5rem; }
  .counter button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .counter button:hover:not(:disabled) { background: var(--bg); }
  .counter button:disabled { color: var(--gray-b8); cursor: default; }
  .ok { color: var(--ok-fg); }
  .err { color: var(--error); }
</style>
