import { describe, it, expect } from "vitest";
import {
  parseUserList,
  parseRoleList,
  validateUsername,
  validateRoleName,
  parseRolesInput,
  parsePrivilegesInput,
} from "./users";

const usersInfoJson = JSON.stringify({
  users: [
    { user: "alice", db: "admin", roles: [{ role: "readWrite", db: "shop" }, { role: "read", db: "logs" }] },
    { user: "bob", db: "shop", roles: [] },
  ],
  ok: 1,
});

const rolesInfoJson = JSON.stringify({
  roles: [
    { role: "read", db: "admin", isBuiltin: true, privileges: [], roles: [] },
    {
      role: "reportViewer",
      db: "admin",
      isBuiltin: false,
      privileges: [{ resource: { db: "shop", collection: "orders" }, actions: ["find"] }],
      roles: [{ role: "read", db: "shop" }],
    },
  ],
  ok: 1,
});

describe("parseUserList", () => {
  it("parses users with their roles", () => {
    const users = parseUserList(usersInfoJson);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({
      user: "alice",
      db: "admin",
      roles: [{ role: "readWrite", db: "shop" }, { role: "read", db: "logs" }],
    });
  });

  it("empty roles array parses to []", () => {
    const users = parseUserList(usersInfoJson);
    expect(users[1].roles).toEqual([]);
  });

  it("missing users field parses to []", () => {
    expect(parseUserList(JSON.stringify({ ok: 1 }))).toEqual([]);
  });
});

describe("parseRoleList", () => {
  it("parses built-in and custom roles", () => {
    const roles = parseRoleList(rolesInfoJson);
    expect(roles).toHaveLength(2);
    expect(roles[0].isBuiltin).toBe(true);
    expect(roles[1].isBuiltin).toBe(false);
  });

  it("keeps privileges untouched (pass-through)", () => {
    const roles = parseRoleList(rolesInfoJson);
    expect(roles[1].privileges).toEqual([
      { resource: { db: "shop", collection: "orders" }, actions: ["find"] },
    ]);
  });

  it("parses inherited roles", () => {
    const roles = parseRoleList(rolesInfoJson);
    expect(roles[1].roles).toEqual([{ role: "read", db: "shop" }]);
  });

  it("missing roles field parses to []", () => {
    expect(parseRoleList(JSON.stringify({ ok: 1 }))).toEqual([]);
  });
});

describe("validateUsername", () => {
  it("valid → null", () => {
    expect(validateUsername("alice")).toBeNull();
  });
  it("empty → err_username_empty", () => {
    expect(validateUsername("")).toBe("err_username_empty");
  });
  it("whitespace only → err_username_empty", () => {
    expect(validateUsername("   ")).toBe("err_username_empty");
  });
});

describe("validateRoleName", () => {
  it("valid → null", () => {
    expect(validateRoleName("reportViewer")).toBeNull();
  });
  it("empty → err_role_name_empty", () => {
    expect(validateRoleName("")).toBe("err_role_name_empty");
  });
});

describe("parseRolesInput", () => {
  it("valid JSON array → ok with normalized json", () => {
    const r = parseRolesInput('[{"role":"read","db":"shop"}]');
    expect(r).toEqual({ ok: true, json: '[{"role":"read","db":"shop"}]' });
  });
  it("blank text → ok with []", () => {
    expect(parseRolesInput("   ")).toEqual({ ok: true, json: "[]" });
  });
  it("invalid JSON → err_roles_invalid_json", () => {
    expect(parseRolesInput("{bad")).toEqual({ ok: false, error: "err_roles_invalid_json" });
  });
  it("valid JSON but not an array → err_roles_not_array", () => {
    expect(parseRolesInput('{"role":"read"}')).toEqual({ ok: false, error: "err_roles_not_array" });
  });
});

describe("parsePrivilegesInput", () => {
  it("valid JSON array → ok with normalized json", () => {
    const r = parsePrivilegesInput('[{"resource":{"db":"shop","collection":""},"actions":["find"]}]');
    expect(r.ok).toBe(true);
  });
  it("blank text → ok with []", () => {
    expect(parsePrivilegesInput("")).toEqual({ ok: true, json: "[]" });
  });
  it("invalid JSON → err_privileges_invalid_json", () => {
    expect(parsePrivilegesInput("[1,")).toEqual({ ok: false, error: "err_privileges_invalid_json" });
  });
  it("valid JSON but not an array → err_privileges_not_array", () => {
    expect(parsePrivilegesInput('{"a":1}')).toEqual({ ok: false, error: "err_privileges_not_array" });
  });
});
