<script lang="ts">
  import { errorMessage } from "../api/errors";
  import { msgKey } from "$lib/msgkey";
  import type { createUsersRolesView } from "../stores/usersRoles.svelte";
  import type { UserInfo } from "../domain/users";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import * as m from "$lib/paraglide/messages";

  // Narrowed to the subset this component actually reads/calls (not the full Users & Roles view),
  // so a test double only needs to implement these fields.
  type UsersListView = Pick<
    ReturnType<typeof createUsersRolesView>,
    "users" | "usersError" | "usersLoading" | "createUser" | "updateUserRoles" | "changeUserPassword" | "dropUser"
  >;

  let { view, readOnly }: { view: UsersListView; readOnly: boolean } = $props();

  let creating = $state(false);
  let createDb = $state("admin");
  let createUsername = $state("");
  let createPassword = $state("");
  let createRolesText = $state("[]");
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  let editingRoles = $state<UserInfo | null>(null);
  let editRolesText = $state("[]");
  let editError = $state<string | null>(null);
  let editBusy = $state(false);

  let changingPassword = $state<UserInfo | null>(null);
  let newPassword = $state("");
  let passwordError = $state<string | null>(null);
  let passwordBusy = $state(false);

  let confirmDrop = $state<UserInfo | null>(null);

  function openCreate() {
    createDb = "admin";
    createUsername = "";
    createPassword = "";
    createRolesText = "[]";
    createError = null;
    creating = true;
  }

  async function submitCreate() {
    createBusy = true;
    createError = null;
    try {
      await view.createUser(createDb, createUsername, createPassword, createRolesText);
      creating = false;
    } catch (e) {
      createError = errorMessage(e);
    } finally {
      createBusy = false;
    }
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

<div class="userlist">
  <div class="toolbar">
    <button onclick={openCreate} disabled={readOnly}>{m.user_list_create()}</button>
    {#if view.usersLoading}<span class="status">{m.common_loading()}</span>{/if}
  </div>
  {#if view.usersError}<div class="error">{view.usersError}</div>{/if}

  {#if creating}
    <div class="form">
      <label>{m.user_create_db_label()}<input bind:value={createDb} aria-label={m.user_create_db_label()} /></label>
      <label>{m.user_create_username_label()}<input bind:value={createUsername} aria-label={m.user_create_username_label()} /></label>
      <label>{m.user_create_password_label()}<input type="password" bind:value={createPassword} aria-label={m.user_create_password_label()} /></label>
      <label>{m.user_create_roles_label()}
        <div class="jsoneditor"><CodeEditor value={createRolesText} onChange={(v) => (createRolesText = v)} /></div>
      </label>
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
          <th>{m.user_list_col_username()}</th>
          <th>{m.user_list_col_db()}</th>
          <th>{m.user_list_col_roles()}</th>
          <th class="act"></th>
        </tr>
      </thead>
      <tbody>
        {#each view.users as u (u.db + "." + u.user)}
          <tr>
            <td>{u.user}</td>
            <td>{u.db}</td>
            <td class="roles">{u.roles.map((r) => `${r.role}@${r.db}`).join(", ")}</td>
            <td class="act">
              <button disabled={readOnly} onclick={() => openChangePassword(u)}>{m.user_list_change_password()}</button>
              <button disabled={readOnly} onclick={() => openEditRoles(u)}>{m.user_list_edit_roles()}</button>
              <button class="danger" disabled={readOnly} onclick={() => (confirmDrop = u)}>{m.user_list_drop()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

{#if editingRoles}
  {@const target = editingRoles}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) editingRoles = null; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.user_list_edit_roles()}>
      <header>{m.user_list_edit_roles()} — {target.user}</header>
      <div class="body">
        <label>{m.user_create_roles_label()}
          <div class="jsoneditor"><CodeEditor value={editRolesText} onChange={(v) => (editRolesText = v)} /></div>
        </label>
        {#if editError}<div class="dlg-error">{msgKey(editError)}</div>{/if}
      </div>
      <footer>
        <button onclick={() => (editingRoles = null)}>{m.common_cancel()}</button>
        <button class="primary" disabled={editBusy} onclick={submitEditRoles}>{m.common_save()}</button>
      </footer>
    </div>
  </div>
{/if}

{#if changingPassword}
  {@const target = changingPassword}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) changingPassword = null; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.user_password_modal_title()}>
      <header>{m.user_password_modal_title()} — {target.user}</header>
      <div class="body">
        <label>{m.user_password_modal_label()}<input type="password" bind:value={newPassword} aria-label={m.user_password_modal_label()} /></label>
        {#if passwordError}<div class="dlg-error">{msgKey(passwordError)}</div>{/if}
      </div>
      <footer>
        <button onclick={() => (changingPassword = null)}>{m.common_cancel()}</button>
        <button class="primary" disabled={passwordBusy} onclick={submitChangePassword}>{m.common_save()}</button>
      </footer>
    </div>
  </div>
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
  .userlist { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); display: flex; align-items: center; gap: 0.625rem; }
  .toolbar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar button:hover:not(:disabled) { background: var(--bg); }
  .toolbar button:disabled { color: var(--gray-b8); cursor: default; }
  .status { color: var(--muted); font-size: 0.75rem; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: var(--zebra); }
  .roles { font-family: ui-monospace, monospace; }
  td.act, th.act { white-space: nowrap; }
  td.act button { border: none; background: none; cursor: pointer; margin-right: 0.375rem; }
  td.act button:disabled { cursor: default; color: var(--gray-b8); }
  .danger { color: var(--error); }
  .danger:disabled { color: var(--gray-b8); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .form { border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.75rem; margin: 0.5rem; font-size: 0.8125rem; background: var(--zebra); }
  .form label { display: block; margin-top: 0.5rem; }
  .form input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.25rem 0.375rem; font-family: inherit; }
  .jsoneditor { height: 6rem; border: 1px solid var(--border); border-radius: 0.25rem; overflow: auto; margin-top: 0.25rem; }
  .dlg-error { color: var(--error); margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--panel); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  .modal header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .modal .body { padding: 0.875rem; font-size: 0.8125rem; }
  .modal label { display: block; }
  .modal input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.25rem 0.375rem; }
</style>
