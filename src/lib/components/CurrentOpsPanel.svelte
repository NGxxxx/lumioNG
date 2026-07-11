<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createCurrentOps } from "../stores/currentOps.svelte";
  import { OWN_APP_NAME } from "../domain/host";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import * as m from "$lib/paraglide/messages";

  const v = untrack(() => createCurrentOps(sessionManager.active?.id ?? ""));
  onMount(() => v.load());

  const readOnly = $derived(sessionManager.active?.readOnly ?? false);
  let confirmOpid = $state<number | null>(null);

  function confirmKill() {
    const opid = confirmOpid;
    confirmOpid = null;
    if (opid !== null) v.kill(opid);
  }
</script>

<div class="currentops">
  <div class="bar">
    <button onclick={() => v.load()}>{m.current_ops_refresh()}</button>
    {#if v.loading}<span class="status">{m.common_loading()}</span>{/if}
  </div>
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.ops.length > 0}
    <table>
      <thead>
        <tr>
          <th>{m.current_ops_col_opid()}</th>
          <th>{m.current_ops_col_secs()}</th>
          <th>{m.current_ops_col_op()}</th>
          <th>{m.current_ops_col_ns()}</th>
          <th>{m.current_ops_col_client()}</th>
          <th>{m.current_ops_col_app()}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each v.ops as o (o.opid)}
          {@const own = o.appName === OWN_APP_NAME}
          <tr class:own>
            <td class="v">{o.opid}</td>
            <td class="v">{o.secsRunning ?? "—"}</td>
            <td class="v">{o.op ?? "—"}</td>
            <td class="v">{o.ns ?? "—"}</td>
            <td class="v">{o.client ?? "—"}</td>
            <td class="v">
              {o.appName ?? "—"}
              {#if own}<span class="you">{m.current_ops_you()}</span>{/if}
            </td>
            <td>
              <button
                class="kill"
                disabled={readOnly || v.killing === o.opid}
                onclick={() => (confirmOpid = o.opid)}
              >{m.current_ops_kill()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if !v.loading && !v.error}
    <div class="status">{m.current_ops_empty()}</div>
  {/if}
</div>

{#if confirmOpid !== null}
  <ConfirmDialog
    title={m.current_ops_kill_title()}
    message={m.current_ops_kill_message({ opid: confirmOpid })}
    confirmLabel={m.current_ops_kill()}
    danger
    onconfirm={confirmKill}
    oncancel={() => (confirmOpid = null)}
  />
{/if}

<style>
  .currentops { height: 100%; box-sizing: border-box; overflow: auto; background: var(--panel); padding: 0.875rem 1.125rem; }
  .bar { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.625rem; }
  .bar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .bar button:hover { background: var(--bg); }
  .status { color: var(--muted); font-size: 0.75rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.75rem; user-select: none; }
  th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); }
  .v { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--text-strong); font-family: var(--mono); }
  tr.own .v { background: var(--ok-bg); }
  .you { margin-left: 0.375rem; padding: 0.0625rem 0.375rem; border-radius: 0.5625rem; font-size: 0.625rem; font-family: var(--font-ui, sans-serif); background: var(--ok-strong); color: var(--panel); }
  .kill { height: 1.25rem; padding: 0 0.5rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--error); cursor: pointer; font-size: 0.6875rem; }
  .kill:hover:not(:disabled) { background: var(--error-bg); }
  .kill:disabled { color: var(--gray-b8); cursor: default; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; margin-bottom: 0.625rem; }
</style>
