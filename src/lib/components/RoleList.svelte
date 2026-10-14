<script lang="ts">
  import { untrack } from "svelte";
  import { errorMessage } from "../api/errors";
  import type { createUsersRolesView } from "../stores/usersRoles.svelte";
  import type { RoleInfo } from "../domain/users";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import EntityCrudList from "./EntityCrudList.svelte";
  import EntityEditModal from "./EntityEditModal.svelte";
  import * as m from "#lib/paraglide/messages.js";

  // Narrowed to the subset this component actually reads/calls (not the full Users & Roles view),
  // so a test double only needs to implement these fields.
  type RolesListView = Pick<
    ReturnType<typeof createUsersRolesView>,
    "roles" | "rolesError" | "rolesLoading" | "rolesDb" | "loadRoles" | "createRole" | "updateRole" | "dropRole"
  >;

  let { view, readOnly }: { view: RolesListView; readOnly: boolean } = $props();

  let dbField = $state(untrack(() => view.rolesDb));

  let createName = $state("");
  let createPrivilegesText = $state("[]");
  let createRolesText = $state("[]");

  let editing = $state<RoleInfo | null>(null);
  let editPrivilegesText = $state("[]");
  let editRolesText = $state("[]");
  let editError = $state<string | null>(null);
  let editBusy = $state(false);

  let confirmDrop = $state<RoleInfo | null>(null);

  const columns = $derived([
    { label: m.role_list_col_role(), value: (r: RoleInfo) => r.role },
    { label: m.role_list_col_db(), value: (r: RoleInfo) => r.db },
    { label: m.role_list_col_builtin(), value: (r: RoleInfo) => (r.isBuiltin ? "✓" : "—") },
    { label: m.role_list_col_privileges(), value: (r: RoleInfo) => String(r.privileges.length) },
  ]);

  function resetCreate() {
    createName = "";
    createPrivilegesText = "[]";
    createRolesText = "[]";
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

<EntityCrudList
  rows={view.roles}
  {columns}
  rowKey={(r: RoleInfo) => r.db + "." + r.role}
  {readOnly}
  loading={view.rolesLoading}
  error={view.rolesError}
  createLabel={m.role_list_create()}
  onOpenCreate={resetCreate}
  onCreate={() => view.createRole(dbField, createName, createPrivilegesText, createRolesText)}
>
  {#snippet toolbarStart()}
    <label class="dbfield">{m.role_list_db_label()}<input bind:value={dbField} aria-label={m.role_list_db_label()} /></label>
    <button onclick={() => view.loadRoles(dbField)}>{m.role_list_refresh()}</button>
  {/snippet}

  {#snippet createFields()}
    <label>{m.role_create_name_label()}<input bind:value={createName} aria-label={m.role_create_name_label()} /></label>
    <label>{m.role_create_privileges_label()}
      <div class="jsoneditor"><CodeEditor value={createPrivilegesText} onChange={(v) => (createPrivilegesText = v)} /></div>
    </label>
    <label>{m.role_create_roles_label()}
      <div class="jsoneditor"><CodeEditor value={createRolesText} onChange={(v) => (createRolesText = v)} /></div>
    </label>
  {/snippet}

  {#snippet rowActions(r: RoleInfo)}
    <button disabled={readOnly} onclick={() => openEdit(r)}>{m.role_list_edit()}</button>
    <button class="danger" disabled={readOnly || r.isBuiltin} onclick={() => (confirmDrop = r)}>{m.role_list_drop()}</button>
  {/snippet}
</EntityCrudList>

{#if editing}
  {@const target = editing}
  <EntityEditModal
    title={`${m.role_list_edit()} — ${target.role}`}
    ariaLabel={m.role_list_edit()}
    error={editError}
    busy={editBusy}
    onCancel={() => (editing = null)}
    onSave={submitEdit}
  >
    {#snippet fields()}
      <label>{m.role_create_privileges_label()}
        <div class="jsoneditor"><CodeEditor value={editPrivilegesText} onChange={(v) => (editPrivilegesText = v)} wrap /></div>
      </label>
      <label>{m.role_create_roles_label()}
        <div class="jsoneditor"><CodeEditor value={editRolesText} onChange={(v) => (editRolesText = v)} wrap /></div>
      </label>
    {/snippet}
  </EntityEditModal>
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
  .dbfield { display: flex; align-items: center; gap: 0.375rem; font-size: var(--fs); }
  .dbfield input { width: 8rem; padding: 0.125rem 0.375rem; }
  .jsoneditor { height: 6rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: auto; margin-top: 0.25rem; }
</style>
