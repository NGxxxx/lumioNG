<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { errorMessage } from "../api/errors";
  import { msgKey } from "$lib/msgkey";
  import * as m from "$lib/paraglide/messages";

  // Shared chrome for the admin "list of entities" panels (users, roles): toolbar + error banner +
  // inline create form + scrolling table. Callers supply the columns, the create-form fields and
  // the per-row action buttons; the create form's busy/error handling lives here.
  type Column = { label: string; value: (row: T) => string; mono?: boolean };

  let {
    rows,
    columns,
    rowKey,
    readOnly,
    loading,
    error,
    createLabel,
    onOpenCreate,
    onCreate,
    toolbarStart,
    createFields,
    rowActions,
  }: {
    rows: T[];
    columns: Column[];
    rowKey: (row: T) => string;
    readOnly: boolean;
    loading: boolean;
    error: string | null;
    createLabel: string;
    /** Reset the caller's create-form fields; called just before the form opens. */
    onOpenCreate: () => void;
    /** Rejects with the failure to show inside the create form. */
    onCreate: () => Promise<void>;
    toolbarStart?: Snippet;
    createFields: Snippet;
    rowActions: Snippet<[T]>;
  } = $props();

  let creating = $state(false);
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  function openCreate() {
    onOpenCreate();
    createError = null;
    creating = true;
  }

  async function submitCreate() {
    createBusy = true;
    createError = null;
    try {
      await onCreate();
      creating = false;
    } catch (e) {
      createError = errorMessage(e);
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="crudlist">
  <div class="toolbar">
    {@render toolbarStart?.()}
    <button onclick={openCreate} disabled={readOnly}>{createLabel}</button>
    {#if loading}<span class="status">{m.common_loading()}</span>{/if}
  </div>
  {#if error}<div class="error">{error}</div>{/if}

  {#if creating}
    <div class="form">
      {@render createFields()}
      {#if createError}<div class="dlg-error">{msgKey(createError)}</div>{/if}
      <footer>
        <button onclick={() => (creating = false)}>{m.common_cancel()}</button>
        <button class="primary" disabled={createBusy} onclick={submitCreate}>{m.common_create()}</button>
      </footer>
    </div>
  {/if}

  <div class="scroller">
    <table>
      <thead>
        <tr>
          {#each columns as c}<th>{c.label}</th>{/each}
          <th class="act"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (rowKey(row))}
          <tr>
            {#each columns as c}<td class:mono={c.mono}>{c.value(row)}</td>{/each}
            <td class="act">{@render rowActions(row)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .crudlist { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); display: flex; align-items: center; gap: 0.625rem; }
  /* :global — the toolbar/form/action-cell contents are markup passed in by the caller. */
  .toolbar :global(button) { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar :global(button:hover:not(:disabled)) { background: var(--bg); }
  .toolbar :global(button:disabled) { color: var(--gray-b8); cursor: default; }
  .status { color: var(--muted); font-size: var(--fs); }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: var(--zebra); }
  .mono { font-family: var(--mono); }
  td.act, th.act { white-space: nowrap; }
  td.act :global(button) { border: none; background: none; cursor: pointer; margin-right: 0.375rem; }
  td.act :global(button:disabled) { cursor: default; color: var(--gray-b8); }
  td.act :global(.danger) { color: var(--error); }
  td.act :global(.danger:disabled) { color: var(--gray-b8); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .form { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; margin: 0.5rem; font-size: 0.8125rem; background: var(--zebra); }
  .form :global(label) { display: block; margin-top: 0.5rem; }
  .form :global(input) { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.25rem 0.375rem; font-family: inherit; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
