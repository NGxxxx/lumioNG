<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createTopologyStatus } from "../stores/topology.svelte";
  import * as m from "$lib/paraglide/messages";

  const v = untrack(() => createTopologyStatus(sessionManager.active?.id ?? ""));
  onMount(() => v.load());
</script>

<div class="topology">
  <div class="bar">
    <button onclick={() => v.load()}>{m.topology_refresh()}</button>
    {#if v.loading}<span class="status">{m.common_loading()}</span>{/if}
  </div>
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.info?.kind === "standalone"}
    <div class="status">{m.topology_standalone()}</div>
  {:else if v.info?.kind === "replicaSet"}
    {@const rs = v.info}
    <div class="setname">{m.topology_replset_name({ name: rs.setName })}</div>
    <table>
      <thead>
        <tr>
          <th>{m.topology_col_member()}</th>
          <th>{m.topology_col_state()}</th>
          <th>{m.topology_col_health()}</th>
          <th>{m.topology_col_uptime()}</th>
          <th>{m.topology_col_optime()}</th>
          <th>{m.topology_col_ping()}</th>
        </tr>
      </thead>
      <tbody>
        {#each rs.members as mem (mem.name)}
          <tr class:primary={mem.stateStr === "PRIMARY"}>
            <td class="v">{mem.name}{#if mem.self} <span class="you">{m.topology_self()}</span>{/if}</td>
            <td class="v">{mem.stateStr || "—"}</td>
            <td class="v">{mem.health ?? "—"}</td>
            <td class="v">{mem.uptime ?? "—"}</td>
            <td class="v">{mem.optimeDate ?? "—"}</td>
            <td class="v">{mem.pingMs ?? "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if v.info?.kind === "mongos"}
    {@const mg = v.info}
    <div class="balancer">
      {#if mg.balancer}{m.topology_balancer_mode({ mode: mg.balancer.mode ?? "—" })}{:else}{m.topology_balancer_unknown()}{/if}
    </div>
    <table>
      <thead>
        <tr><th>{m.topology_col_shard()}</th><th>{m.topology_col_host()}</th><th>{m.topology_col_draining()}</th></tr>
      </thead>
      <tbody>
        {#each mg.shards as s (s.id)}
          <tr>
            <td class="v">{s.id}</td>
            <td class="v">{s.host}</td>
            <td class="v">{s.draining ? m.common_yes() : m.common_no()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .topology { height: 100%; box-sizing: border-box; overflow: auto; background: var(--panel); padding: 0.875rem 1.125rem; }
  .bar { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.625rem; }
  .bar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .bar button:hover { background: var(--bg); }
  .status { color: var(--muted); font-size: var(--fs); }
  .setname { font-weight: 600; margin-bottom: 0.5rem; }
  .balancer { color: var(--gray-77); font-size: var(--fs); margin-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: var(--fs); user-select: none; }
  th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); }
  .v { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--text-strong); font-family: var(--mono); }
  tr.primary .v { background: var(--ok-bg); }
  .you { margin-left: 0.375rem; padding: 0.0625rem 0.375rem; border-radius: 0.5625rem; font-size: 0.625rem; font-family: var(--font-ui, sans-serif); background: var(--ok-strong); color: var(--panel); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; margin-bottom: 0.625rem; }
</style>
