<script lang="ts">
  import { untrack } from "svelte";
  import { errorMessage } from "../api/errors";
  import { msgKey } from "$lib/msgkey";
  import type { createUsersRolesView } from "../stores/usersRoles.svelte";
  import type { RoleInfo } from "../domain/users";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import * as m from "$lib/paraglide/messages";

  // Narrowed to the subset this component actually reads/calls (not the full Users & Roles view),
  // so a test double only needs to implement these fields.
  type RolesListView = Pick<
    ReturnType<typeof createUsersRolesView>,
    "roles" | "rolesError" | "rolesLoading" | "rolesDb" | "loadRoles" | "createRole" | "updateRole" | "dropRole"
  >;

  let { view, readOnly }: { view: RolesListView; readOnly: boolean } = $props();

  let dbField = $state(untrack(() => view.rolesDb));

  let creating = $state(false);
  let createName = $state("");
  let createPrivilegesText = $state("[]");
  let createRolesText = $state("[]");
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  let editing = $state<RoleInfo | null>(null);
  let editPrivilegesText = $state("[]");
  let editRolesText = $state("[]");
  let editError = $state<string | null>(null);
  let editBusy = $state(false);

  let confirmDrop = $state<RoleInfo | null>(null);

  function refresh() {
    view.loadRoles(dbField);
  }

  function openCreate() {
    createName = "";
    createPrivilegesText = "[]";
    createRolesText = "[]";
    createError = null;
    creating = true;
  }

  async function submitCreate() {
    createBusy = true;
    createError = null;
    try {
      await view.createRole(dbField, createName, createPrivilegesText, createRolesText);
      creating = false;
    } catch (e) {
      createError = errorMessage(e);
    } finally {
      createBusy = false;
    }
  }

  function openEdit(r: RoleInfo) {
    editing = r;
    editPrivilegesText = JSON.stringify(r.privileges);
    editRolesText = JSON.stringify(r.roles.map((ref) => ({ role: ref.role, db: ref.db })));
    editError = null;
  }

  async function submitEdit() {
    if (!editing) return;
    editBusy = true;
    editError = null;
    try {
      await view.updateRole(editing.db, editing.role, editPrivilegesText, editRolesText);
      editing = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      editBusy = false;
    }
  }

  async function confirmDropRole() {
    const target = confirmDrop;
    confirmDrop = null;
    if (target) await view.dropRole(target.db, target.role);
  }
</script>

<div class="rolelist">
  <div class="toolbar">
    <label class="dbfield">{m.role_list_db_label()}<input bind:value={dbField} aria-label={m.role_list_db_label()} /></label>
    <button onclick={refresh}>{m.role_list_refresh()}</button>
    <button onclick={openCreate} disabled={readOnly}>{m.role_list_create()}</button>
    {#if view.rolesLoading}<span class="status">{m.common_loading()}</span>{/if}
  </div>
  {#if view.rolesError}<div class="error">{view.rolesError}</div>{/if}

  {#if creating}
    <div class="form">
      <label>{m.role_create_name_label()}<input bind:value={createName} aria-label={m.role_create_name_label()} /></label>
      <label>{m.role_create_privileges_label()}
        <div class="jsoneditor"><CodeEditor value={createPrivilegesText} onChange={(v) => (createPrivilegesText = v)} /></div>
      </label>
      <label>{m.role_create_roles_label()}
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
          <th>{m.role_list_col_role()}</th>
          <th>{m.role_list_col_db()}</th>
          <th>{m.role_list_col_builtin()}</th>
          <th>{m.role_list_col_privileges()}</th>
          <th class="act"></th>
        </tr>
      </thead>
      <tbody>
        {#each view.roles as r (r.db + "." + r.role)}
          <tr>
            <td>{r.role}</td>
            <td>{r.db}</td>
            <td>{r.isBuiltin ? "✓" : "—"}</td>
            <td>{r.privileges.length}</td>
            <td class="act">
              <button disabled={readOnly} onclick={() => openEdit(r)}>{m.role_list_edit()}</button>
              <button class="danger" disabled={readOnly || r.isBuiltin} onclick={() => (confirmDrop = r)}>{m.role_list_drop()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

{#if editing}
  {@const target = editing}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) editing = null; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.role_list_edit()}>
      <header>{m.role_list_edit()} — {target.role}</header>
      <div class="body">
        <label>{m.role_create_privileges_label()}
          <div class="jsoneditor"><CodeEditor value={editPrivilegesText} onChange={(v) => (editPrivilegesText = v)} /></div>
        </label>
        <label>{m.role_create_roles_label()}
          <div class="jsoneditor"><CodeEditor value={editRolesText} onChange={(v) => (editRolesText = v)} /></div>
        </label>
        {#if editError}<div class="dlg-error">{msgKey(editError)}</div>{/if}
      </div>
      <footer>
        <button onclick={() => (editing = null)}>{m.common_cancel()}</button>
        <button class="primary" disabled={editBusy} onclick={submitEdit}>{m.common_save()}</button>
      </footer>
    </div>
  </div>
{/if}

{#if confirmDrop}
  <ConfirmDialog
    title={m.role_list_drop_title()}
    message={`${m.role_list_drop_body_prefix()} "${confirmDrop.role}"${m.role_list_drop_body_suffix()}`}
    confirmLabel={m.role_list_drop()}
    danger
    onconfirm={confirmDropRole}
    oncancel={() => (confirmDrop = null)}
  />
{/if}

<style>
  .rolelist { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); display: flex; align-items: center; gap: 0.625rem; }
  .dbfield { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; }
  .dbfield input { width: 8rem; padding: 0.125rem 0.375rem; }
  .toolbar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar button:hover:not(:disabled) { background: var(--bg); }
  .toolbar button:disabled { color: var(--gray-b8); cursor: default; }
  .status { color: var(--muted); font-size: 0.75rem; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: var(--zebra); }
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
</style>
