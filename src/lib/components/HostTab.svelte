<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatUptime } from "../domain/host";
  import { formatCount } from "../domain/stats";
  import type { HostSection } from "../stores/navigation.svelte";
  import CurrentOpsPanel from "./CurrentOpsPanel.svelte";
  import OverviewDashboard from "./overview/OverviewDashboard.svelte";
  import TopologyPanel from "./TopologyPanel.svelte";
  import UsersRolesPanel from "./UsersRolesPanel.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { connection }: { connection: { label: string; uri: string } | null } = $props();

  const activeHost = $derived(sessionManager.active?.host ?? null);
  const h = $derived(activeHost?.info ?? null);

  const nav = $derived(sessionManager.active?.nav ?? null);
  // The section is switched from the panel header's view switcher.
  const section = $derived<HostSection>(nav?.hostSection ?? "info");
</script>

<div class="hosttab">
  <div class="subpane">
    {#if section === "info"}
      <OverviewDashboard {connection}>
        {#snippet details()}
          <div class="host">
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
        {/snippet}
      </OverviewDashboard>
    {:else if section === "currentOps"}
      <CurrentOpsPanel />
    {:else if section === "topology"}
      <TopologyPanel />
    {:else}
      <!-- Users and Roles share one mount (same else-branch) so switching doesn't refetch. -->
      <UsersRolesPanel tab={section === "roles" ? "roles" : "users"} />
    {/if}
  </div>
</div>

<style>
  .hosttab { display: flex; flex-direction: column; height: 100%; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
  .host { padding: 0.5rem 0; }
  h4 { margin: 1rem 0 0.375rem; font-size: var(--fs); color: var(--gray-44); }
  table { border-collapse: collapse; width: 35rem; font-size: var(--fs); user-select: none; }
  .k { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--gray-55); width: 15rem; }
  .v { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--text-strong); font-family: var(--mono); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; margin-bottom: 0.625rem; }
  .status { color: var(--muted); }
</style>
