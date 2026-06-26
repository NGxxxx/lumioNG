<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatUptime } from "../domain/host";
  import { formatCount } from "../domain/stats";
  import { maskUri } from "../domain/uri";
  import * as m from "$lib/paraglide/messages";

  let { connection }: { connection: { label: string; uri: string } | null } = $props();

  const activeHost = $derived(sessionManager.active?.host ?? null);
  const h = $derived(activeHost?.info ?? null);
</script>

<div class="host">
  <div class="title">{connection?.label ?? "—"}</div>
  <div class="sub">{connection?.uri ? maskUri(connection.uri) : "—"}</div>
  {#if activeHost?.error}<div class="error">{activeHost.error}</div>{/if}
  {#if activeHost?.loading && !h}<div class="status">{m.common_loading()}</div>{/if}
  {#if h}
    <table>
      <tbody>
        <tr><td class="k">version</td><td class="v">{h.version ?? "—"}</td></tr>
        <tr><td class="k">storageEngine</td><td class="v">{h.storageEngine ?? "—"}</td></tr>
        <tr><td class="k">hostname</td><td class="v">{h.hostname ?? "—"}</td></tr>
        <tr><td class="k">os</td><td class="v">{h.os ?? "—"}</td></tr>
        <tr><td class="k">uptime</td><td class="v">{formatUptime(h.uptimeSeconds)}</td></tr>
        <tr><td class="k">connections.current</td><td class="v">{formatCount(h.connectionsCurrent)}</td></tr>
        <tr><td class="k">connections.available</td><td class="v">{formatCount(h.connectionsAvailable)}</td></tr>
        <tr><td class="k">mem.resident</td><td class="v">{h.memResidentMb ?? "—"} MB</td></tr>
        <tr><td class="k">mem.virtual</td><td class="v">{h.memVirtualMb ?? "—"} MB</td></tr>
        <tr><td class="k">network.numRequests</td><td class="v">{formatCount(h.network.numRequests)}</td></tr>
      </tbody>
    </table>
    <h4>{m.host_tab_opcounters()}</h4>
    <table>
      <tbody>
        {#each Object.entries(h.opcounters) as [k, val] (k)}
          <tr><td class="k">{k}</td><td class="v">{formatCount(val)}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .host { height: 100%; box-sizing: border-box; overflow: auto; background: var(--panel); padding: 0.875rem 1.125rem; }
  .title { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.1875rem; }
  .sub { color: var(--gray-77); margin-bottom: 0.875rem; }
  h4 { margin: 1rem 0 0.375rem; font-size: 0.75rem; color: var(--gray-44); }
  table { border-collapse: collapse; width: 35rem; font-size: 0.75rem; }
  .k { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--gray-55); width: 15rem; }
  .v { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--text-strong); font-family: var(--mono); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; margin-bottom: 0.625rem; }
  .status { color: var(--muted); }
</style>
