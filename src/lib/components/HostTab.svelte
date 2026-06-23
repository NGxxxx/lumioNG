<script lang="ts">
  import { onMount } from "svelte";
  import { hostStatus } from "../stores/hostStatus.svelte";
  import { formatUptime } from "../domain/host";
  import { formatCount } from "../domain/stats";
  import { maskUri } from "../domain/uri";
  import * as m from "$lib/paraglide/messages";

  let { connection }: { connection: { label: string; uri: string } | null } = $props();

  onMount(() => {
    if (!hostStatus.info && !hostStatus.loading) hostStatus.load();
  });

  const h = $derived(hostStatus.info);
</script>

<div class="host">
  <div class="title">{connection?.label ?? "—"}</div>
  <div class="sub">{connection?.uri ? maskUri(connection.uri) : "—"}</div>
  {#if hostStatus.error}<div class="error">{hostStatus.error}</div>{/if}
  {#if hostStatus.loading && !h}<div class="status">{m.common_loading()}</div>{/if}
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
  .host { height: 100%; box-sizing: border-box; overflow: auto; background: var(--panel); padding: 14px 18px; }
  .title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
  .sub { color: #777; margin-bottom: 14px; }
  h4 { margin: 16px 0 6px; font-size: 12px; color: #444; }
  table { border-collapse: collapse; width: 560px; font-size: 12px; }
  .k { padding: 4px 10px; border: 1px solid var(--cell-border); color: #555; width: 240px; }
  .v { padding: 4px 10px; border: 1px solid var(--cell-border); color: #1a1a1a; font-family: var(--mono); }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; margin-bottom: 10px; }
  .status { color: var(--muted); }
</style>
