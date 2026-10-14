import {
  listUsers,
  createUser as apiCreateUser,
  updateUserRoles as apiUpdateUserRoles,
  changeUserPassword as apiChangeUserPassword,
  dropUser as apiDropUser,
  listRoles,
  createRole as apiCreateRole,
  updateRole as apiUpdateRole,
  dropRole as apiDropRole,
} from "../api/users";
import {
  parseUserList,
  parseRoleList,
  validateUsername,
  validateRoleName,
  parseRolesInput,
  parsePrivilegesInput,
  type UserInfo,
  type RoleInfo,
} from "../domain/users";
import { validateDatabaseName } from "../domain/namespaces";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import * as m from "#lib/paraglide/messages.js";
import {
  listUsersCmd,
  createUserCmd,
  updateUserRolesCmd,
  changeUserPasswordCmd,
  dropUserCmd,
  listRolesCmd,
  createRoleCmd,
  updateRoleCmd,
  dropRoleCmd,
} from "../domain/mongosh";

const DEFAULT_ROLES_DB = "admin";

/** State and actions for the Host tab's "Users & Roles" sub-tab; parse/validate logic lives in domain. */
export function createUsersRolesView(sessionId: string) {
  let users = $state<UserInfo[]>([]);
  let usersError = $state<string | null>(null);
  let usersLoading = $state(false);

  let roles = $state<RoleInfo[]>([]);
  let rolesError = $state<string | null>(null);
  let rolesLoading = $state(false);
  let rolesDb = $state(DEFAULT_ROLES_DB);
  /** Bumped on every loadRoles() call so a slower, superseded call can't overwrite fresher state. */
  let rolesGeneration = 0;
  /** Bumped on every loadUsers() call so a slower, superseded call can't overwrite fresher state. */
  let usersGeneration = 0;

  async function loadUsers() {
    usersLoading = true;
    const gen = ++usersGeneration;
    try {
      const raw = await commandLog.pushTimed(listUsersCmd(), sessionId, () => listUsers(sessionId));
      if (gen !== usersGeneration) return;
      users = parseUserList(raw);
      usersError = null;
    } catch (e) {
      if (gen !== usersGeneration) return;
      usersError = errorMessage(e);
    } finally {
      if (gen === usersGeneration) usersLoading = false;
    }
  }

  async function loadRoles(db: string) {
    rolesLoading = true;
    const gen = ++rolesGeneration;
    try {
      const raw = await commandLog.pushTimed(listRolesCmd(db), sessionId, () => listRoles(sessionId, db));
      if (gen !== rolesGeneration) return;
      roles = parseRoleList(raw);
      rolesDb = db;
      rolesError = null;
    } catch (e) {
      if (gen !== rolesGeneration) return;
      rolesError = errorMessage(e);
    } finally {
      if (gen === rolesGeneration) rolesLoading = false;
    }
  }

  async function init() {
    activity.begin(m.common_running());
    try {
      await Promise.allSettled([loadUsers(), loadRoles(rolesDb)]);
    } finally {
      activity.end();
    }
  }

  async function createUser(db: string, username: string, password: string, rolesText: string) {
    const dbMsg = validateDatabaseName(db);
    if (dbMsg) throw dbMsg;
    const userMsg = validateUsername(username);
    if (userMsg) throw userMsg;
    const rolesResult = parseRolesInput(rolesText);
    if (!rolesResult.ok) throw rolesResult.error;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(createUserCmd(db, username, rolesResult.json), sessionId, () =>
        apiCreateUser(sessionId, db, username, password, rolesResult.json));
      await loadUsers();
    } finally {
      activity.end();
    }
  }

  async function updateUserRoles(db: string, username: string, rolesText: string) {
    const rolesResult = parseRolesInput(rolesText);
    if (!rolesResult.ok) throw rolesResult.error;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(updateUserRolesCmd(db, username, rolesResult.json), sessionId, () =>
        apiUpdateUserRoles(sessionId, db, username, rolesResult.json));
      await loadUsers();
    } finally {
      activity.end();
    }
  }

  async function changeUserPassword(db: string, username: string, password: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(changeUserPasswordCmd(db, username), sessionId, () =>
        apiChangeUserPassword(sessionId, db, username, password));
    } finally {
      activity.end();
    }
  }

  async function dropUser(db: string, username: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropUserCmd(db, username), sessionId, () =>
        apiDropUser(sessionId, db, username));
      await loadUsers();
    } catch (e) {
      usersError = errorMessage(e);
    } finally {
      activity.end();
    }
  }

  async function createRole(db: string, roleName: string, privilegesText: string, rolesText: string) {
    const dbMsg = validateDatabaseName(db);
    if (dbMsg) throw dbMsg;
    const nameMsg = validateRoleName(roleName);
    if (nameMsg) throw nameMsg;
    const privResult = parsePrivilegesInput(privilegesText);
    if (!privResult.ok) throw privResult.error;
    const rolesResult = parseRolesInput(rolesText);
    if (!rolesResult.ok) throw rolesResult.error;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(
        createRoleCmd(db, roleName, privResult.json, rolesResult.json),
        sessionId,
        () => apiCreateRole(sessionId, db, roleName, privResult.json, rolesResult.json),
      );
      await loadRoles(db);
    } finally {
      activity.end();
    }
  }

  async function updateRole(db: string, roleName: string, privilegesText: string, rolesText: string) {
    const privResult = parsePrivilegesInput(privilegesText);
    if (!privResult.ok) throw privResult.error;
    const rolesResult = parseRolesInput(rolesText);
    if (!rolesResult.ok) throw rolesResult.error;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(
        updateRoleCmd(db, roleName, privResult.json, rolesResult.json),
        sessionId,
        () => apiUpdateRole(sessionId, db, roleName, privResult.json, rolesResult.json),
      );
      await loadRoles(db);
    } finally {
      activity.end();
    }
  }

  async function dropRole(db: string, roleName: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropRoleCmd(db, roleName), sessionId, () =>
        apiDropRole(sessionId, db, roleName));
      await loadRoles(db);
    } catch (e) {
      rolesError = errorMessage(e);
    } finally {
      activity.end();
    }
  }

  return {
    get users() { return users; },
    get usersError() { return usersError; },
    get usersLoading() { return usersLoading; },
    get roles() { return roles; },
    get rolesError() { return rolesError; },
    get rolesLoading() { return rolesLoading; },
    get rolesDb() { return rolesDb; },
    init,
    loadUsers,
    loadRoles,
    createUser,
    updateUserRoles,
    changeUserPassword,
    dropUser,
    createRole,
    updateRole,
    dropRole,
  };
}
