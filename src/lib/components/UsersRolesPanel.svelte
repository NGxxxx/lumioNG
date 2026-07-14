<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createUsersRolesView } from "../stores/usersRoles.svelte";
  import UserList from "./UserList.svelte";
  import RoleList from "./RoleList.svelte";

  // Section selection lives in the host subtab strip (HostTab); this panel only renders the list.
  let { tab = "users" }: { tab?: "users" | "roles" } = $props();

  const view = untrack(() => createUsersRolesView(sessionManager.active?.id ?? ""));
  onMount(() => view.init());

  const readOnly = $derived(sessionManager.active?.readOnly ?? false);
</script>

<div class="usersroles">
  <div class="subpane">
    {#if tab === "users"}
      <UserList {view} {readOnly} />
    {:else}
      <RoleList {view} {readOnly} />
    {/if}
  </div>
</div>

<style>
  .usersroles { display: flex; flex-direction: column; height: 100%; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
</style>
