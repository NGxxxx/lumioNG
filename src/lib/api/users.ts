import { invoke } from "@tauri-apps/api/core";

export async function listUsers(sessionId: string): Promise<string> {
  return await invoke<string>("list_users", { sessionId });
}

export async function createUser(
  sessionId: string,
  db: string,
  username: string,
  password: string,
  roles: string,
): Promise<void> {
  await invoke("create_user", { sessionId, db, username, password, roles });
}

export async function updateUserRoles(
  sessionId: string,
  db: string,
  username: string,
  roles: string,
): Promise<void> {
  await invoke("update_user_roles", { sessionId, db, username, roles });
}

export async function changeUserPassword(
  sessionId: string,
  db: string,
  username: string,
  password: string,
): Promise<void> {
  await invoke("change_user_password", { sessionId, db, username, password });
}

export async function dropUser(sessionId: string, db: string, username: string): Promise<void> {
  await invoke("drop_user", { sessionId, db, username });
}

export async function listRoles(sessionId: string, db: string): Promise<string> {
  return await invoke<string>("list_roles", { sessionId, db });
}

export async function createRole(
  sessionId: string,
  db: string,
  roleName: string,
  privileges: string,
  roles: string,
): Promise<void> {
  await invoke("create_role", { sessionId, db, roleName, privileges, roles });
}

export async function updateRole(
  sessionId: string,
  db: string,
  roleName: string,
  privileges: string,
  roles: string,
): Promise<void> {
  await invoke("update_role", { sessionId, db, roleName, privileges, roles });
}

export async function dropRole(sessionId: string, db: string, roleName: string): Promise<void> {
  await invoke("drop_role", { sessionId, db, roleName });
}
