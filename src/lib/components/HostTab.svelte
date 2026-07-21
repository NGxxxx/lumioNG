<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatUptime } from "../domain/host";
  import { formatCount } from "../domain/stats";
  import { maskUri } from "../domain/uri";
  import type { HostSection } from "../stores/navigation.svelte";
  import CurrentOpsPanel from "./CurrentOpsPanel.svelte";
  import UsersRolesPanel from "./UsersRolesPanel.svelte";
  import * as m from "$lib/paraglide/messages";

  let { connection }: { connection: { label: string; uri: string } | null } = $props();

  const activeHost = $derived(sessionManager.active?.host ?? null);
  const h = $derived(activeHost?.info ?? null);

  const nav = $derived(sessionManager.active?.nav ?? null);
  const section = $derived<HostSection>(nav?.hostSection ?? "info");
  function setSection(s: HostSection) {
    nav?.setHostSection(s);
  }
</script>

<div class="hosttab">
  <div class="subtabs">
    <button class:active={section === "info"} onclick={() => setSection("info")}>{m.host_tab_info()}</button>
    <button class:active={section === "currentOps"} onclick={() => setSection("currentOps")}>{m.host_tab_current_ops()}</button>
    <button class:active={section === "users"} onclick={() => setSection("users")}>{m.users_roles_toggle_users()}</button>
    <button class:active={section === "roles"} onclick={() => setSection("roles")}>{m.users_roles_toggle_roles()}</button>
  </div>
  <div class="subpane">
    {#if section === "info"}
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
    {:else if section === "currentOps"}
      <CurrentOpsPanel />
    {:else}
      <!-- Users and Roles share one mount (same else-branch) so switching doesn't refetch. -->
      <UsersRolesPanel tab={section === "roles" ? "roles" : "users"} />
    {/if}
  </div>
</div>

<style>
  .hosttab { display: flex; flex-direction: column; height: 100%; }
  .subtabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg); }
  .subtabs button { border: none; background: none; color: var(--fg); padding: 0.375rem 0.75rem; font-size: var(--fs); cursor: pointer; border-right: 1px solid var(--border); }
  .subtabs button.active { background: var(--panel); font-weight: 600; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
  .host { height: 100%; box-sizing: border-box; overflow: auto; background: var(--panel); padding: 0.875rem 1.125rem; }
  .title { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.1875rem; }
  .sub { color: var(--gray-77); margin-bottom: 0.875rem; }
  h4 { margin: 1rem 0 0.375rem; font-size: var(--fs); color: var(--gray-44); }
  table { border-collapse: collapse; width: 35rem; font-size: var(--fs); user-select: none; }
  .k { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--gray-55); width: 15rem; }
  .v { padding: 0.25rem 0.625rem; border: 1px solid var(--cell-border); color: var(--text-strong); font-family: var(--mono); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; margin-bottom: 0.625rem; }
  .status { color: var(--muted); }
</style>
