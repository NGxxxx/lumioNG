<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { createUsersRolesView } from "../stores/usersRoles.svelte";
  import UserList from "./UserList.svelte";
  import RoleList from "./RoleList.svelte";
  import * as m from "$lib/paraglide/messages";

  const view = untrack(() => createUsersRolesView(sessionManager.active?.id ?? ""));
  onMount(() => view.init());

  const readOnly = $derived(sessionManager.active?.readOnly ?? false);
  let tab = $state<"users" | "roles">("users");
</script>

<div class="usersroles">
  <div class="subtabs">
    <button class:active={tab === "users"} onclick={() => (tab = "users")}>{m.users_roles_toggle_users()}</button>
    <button class:active={tab === "roles"} onclick={() => (tab = "roles")}>{m.users_roles_toggle_roles()}</button>
  </div>
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
  .subtabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg); }
  .subtabs button { border: none; background: none; color: var(--fg); padding: 0.25rem 0.625rem; font-size: 0.75rem; cursor: pointer; border-right: 1px solid var(--border); }
  .subtabs button.active { background: var(--panel); font-weight: 600; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
</style>
