<script lang="ts">
  import { errorMessage } from "../api/errors";
  import type { createUsersRolesView } from "../stores/usersRoles.svelte";
  import type { UserInfo } from "../domain/users";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import EntityCrudList from "./EntityCrudList.svelte";
  import EntityEditModal from "./EntityEditModal.svelte";
  import * as m from "#lib/paraglide/messages.js";

  // Narrowed to the subset this component actually reads/calls (not the full Users & Roles view),
  // so a test double only needs to implement these fields.
  type UsersListView = Pick<
    ReturnType<typeof createUsersRolesView>,
    "users" | "usersError" | "usersLoading" | "createUser" | "updateUserRoles" | "changeUserPassword" | "dropUser"
  >;

  let { view, readOnly }: { view: UsersListView; readOnly: boolean } = $props();

  let createDb = $state("admin");
  let createUsername = $state("");
  let createPassword = $state("");
  let createRolesText = $state("[]");

  let editingRoles = $state<UserInfo | null>(null);
  let editRolesText = $state("[]");
  let editError = $state<string | null>(null);
  let editBusy = $state(false);

  let changingPassword = $state<UserInfo | null>(null);
  let newPassword = $state("");
  let passwordError = $state<string | null>(null);
  let passwordBusy = $state(false);

  let confirmDrop = $state<UserInfo | null>(null);

  const columns = $derived([
    { label: m.user_list_col_username(), value: (u: UserInfo) => u.user },
    { label: m.user_list_col_db(), value: (u: UserInfo) => u.db },
    { label: m.user_list_col_roles(), value: (u: UserInfo) => u.roles.map((r) => `${r.role}@${r.db}`).join(", "), mono: true },
  ]);

  function resetCreate() {
    createDb = "admin";
    createUsername = "";
    createPassword = "";
    createRolesText = "[]";
  }

  function openEditRoles(u: UserInfo) {
    editingRoles = u;
    editRolesText = JSON.stringify(u.roles.map((r) => ({ role: r.role, db: r.db })));
    editError = null;
  }

  async function submitEditRoles() {
    if (!editingRoles) return;
    editBusy = true;
    editError = null;
    try {
      await view.updateUserRoles(editingRoles.db, editingRoles.user, editRolesText);
      editingRoles = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      editBusy = false;
    }
  }

  function openChangePassword(u: UserInfo) {
    changingPassword = u;
    newPassword = "";
    passwordError = null;
  }

  async function submitChangePassword() {
    if (!changingPassword) return;
    passwordBusy = true;
    passwordError = null;
    try {
      await view.changeUserPassword(changingPassword.db, changingPassword.user, newPassword);
      changingPassword = null;
    } catch (e) {
      passwordError = errorMessage(e);
    } finally {
      passwordBusy = false;
    }
  }

  async function confirmDropUser() {
    const target = confirmDrop;
    confirmDrop = null;
    if (target) await view.dropUser(target.db, target.user);
  }
</script>

<EntityCrudList
  rows={view.users}
  {columns}
  rowKey={(u: UserInfo) => u.db + "." + u.user}
  {readOnly}
  loading={view.usersLoading}
  error={view.usersError}
  createLabel={m.user_list_create()}
  onOpenCreate={resetCreate}
  onCreate={() => view.createUser(createDb, createUsername, createPassword, createRolesText)}
>
  {#snippet createFields()}
    <label>{m.user_create_db_label()}<input bind:value={createDb} aria-label={m.user_create_db_label()} /></label>
    <label>{m.user_create_username_label()}<input bind:value={createUsername} aria-label={m.user_create_username_label()} /></label>
    <label>{m.user_create_password_label()}<input type="password" bind:value={createPassword} aria-label={m.user_create_password_label()} /></label>
    <label>{m.user_create_roles_label()}
      <div class="jsoneditor"><CodeEditor value={createRolesText} onChange={(v) => (createRolesText = v)} /></div>
    </label>
  {/snippet}

  {#snippet rowActions(u: UserInfo)}
    <button disabled={readOnly} onclick={() => openChangePassword(u)}>{m.user_list_change_password()}</button>
    <button disabled={readOnly} onclick={() => openEditRoles(u)}>{m.user_list_edit_roles()}</button>
    <button class="danger" disabled={readOnly} onclick={() => (confirmDrop = u)}>{m.user_list_drop()}</button>
  {/snippet}
</EntityCrudList>

{#if editingRoles}
  {@const target = editingRoles}
  <EntityEditModal
    title={`${m.user_list_edit_roles()} — ${target.user}`}
    ariaLabel={m.user_list_edit_roles()}
    error={editError}
    busy={editBusy}
    onCancel={() => (editingRoles = null)}
    onSave={submitEditRoles}
  >
    {#snippet fields()}
      <label>{m.user_create_roles_label()}
        <div class="jsoneditor"><CodeEditor value={editRolesText} onChange={(v) => (editRolesText = v)} wrap /></div>
      </label>
    {/snippet}
  </EntityEditModal>
{/if}

{#if changingPassword}
  {@const target = changingPassword}
  <EntityEditModal
    title={`${m.user_password_modal_title()} — ${target.user}`}
    ariaLabel={m.user_password_modal_title()}
    error={passwordError}
    busy={passwordBusy}
    onCancel={() => (changingPassword = null)}
    onSave={submitChangePassword}
  >
    {#snippet fields()}
      <label>{m.user_password_modal_label()}<input type="password" bind:value={newPassword} aria-label={m.user_password_modal_label()} /></label>
    {/snippet}
  </EntityEditModal>
{/if}

{#if confirmDrop}
  <ConfirmDialog
    title={m.user_list_drop_title()}
    message={`${m.user_list_drop_body_prefix()} "${confirmDrop.user}"${m.user_list_drop_body_suffix()}`}
    confirmLabel={m.user_list_drop()}
    danger
    onconfirm={confirmDropUser}
    oncancel={() => (confirmDrop = null)}
  />
{/if}

<style>
  .jsoneditor { height: 6rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: auto; margin-top: 0.25rem; }
</style>
