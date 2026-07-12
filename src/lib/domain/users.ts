/** Parse, validate MongoDB user and role documents (usersInfo/rolesInfo responses). */

export interface UserRoleRef {
  role: string;
  db: string;
}

export interface UserInfo {
  user: string;
  db: string;
  roles: UserRoleRef[];
}

export interface RoleInfo {
  role: string;
  db: string;
  isBuiltin: boolean;
  privileges: unknown[]; // pass-through BSON, not modeled further in v1
  roles: UserRoleRef[]; // inherited roles
}

export type ParseResult = { ok: true; json: string } | { ok: false; error: string };

function parseRoleRefs(v: unknown): UserRoleRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ role: String(r.role ?? ""), db: String(r.db ?? "") }));
}

/** Curate a `usersInfo` response (whole command doc, Canonical ExtJSON) into a list of users. */
export function parseUserList(json: string): UserInfo[] {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const users = Array.isArray(parsed.users) ? (parsed.users as Record<string, unknown>[]) : [];
  return users.map((u) => ({
    user: String(u.user ?? ""),
    db: String(u.db ?? ""),
    roles: parseRoleRefs(u.roles),
  }));
}

/** Curate a `rolesInfo` response (whole command doc, Canonical ExtJSON) into a list of roles. */
export function parseRoleList(json: string): RoleInfo[] {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const roles = Array.isArray(parsed.roles) ? (parsed.roles as Record<string, unknown>[]) : [];
  return roles.map((r) => ({
    role: String(r.role ?? ""),
    db: String(r.db ?? ""),
    isBuiltin: r.isBuiltin === true,
    privileges: Array.isArray(r.privileges) ? r.privileges : [],
    roles: parseRoleRefs(r.roles),
  }));
}

/** Returns a message key or null. */
export function validateUsername(name: string): string | null {
  if (name.trim().length === 0) return "err_username_empty";
  return null;
}

/** Returns a message key or null. */
export function validateRoleName(name: string): string | null {
  if (name.trim().length === 0) return "err_role_name_empty";
  return null;
}

function parseJsonArrayInput(text: string, invalidJsonError: string, notArrayError: string): ParseResult {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed === "" ? "[]" : trimmed);
  } catch {
    return { ok: false, error: invalidJsonError };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: notArrayError };
  return { ok: true, json: JSON.stringify(parsed) };
}

/** Validate a `{role, db}[]` field (a user's roles, or a role's inherited roles). */
export function parseRolesInput(text: string): ParseResult {
  return parseJsonArrayInput(text, "err_roles_invalid_json", "err_roles_not_array");
}

/** Validate a privileges-array field for createRole/updateRole. */
export function parsePrivilegesInput(text: string): ParseResult {
  return parseJsonArrayInput(text, "err_privileges_invalid_json", "err_privileges_not_array");
}
