import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/users", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserRoles: vi.fn(),
  changeUserPassword: vi.fn(),
  dropUser: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  dropRole: vi.fn(),
}));

import * as api from "../api/users";
import { createUsersRolesView } from "./usersRoles.svelte";
import { commandLog } from "./commandLog.svelte";

const listUsers = api.listUsers as ReturnType<typeof vi.fn>;
const createUser = api.createUser as ReturnType<typeof vi.fn>;
const updateUserRoles = api.updateUserRoles as ReturnType<typeof vi.fn>;
const changeUserPassword = api.changeUserPassword as ReturnType<typeof vi.fn>;
const dropUser = api.dropUser as ReturnType<typeof vi.fn>;
const listRoles = api.listRoles as ReturnType<typeof vi.fn>;
const createRole = api.createRole as ReturnType<typeof vi.fn>;
const updateRole = api.updateRole as ReturnType<typeof vi.fn>;
const dropRole = api.dropRole as ReturnType<typeof vi.fn>;

const usersJson = JSON.stringify({ users: [{ user: "alice", db: "admin", roles: [] }] });
const rolesJson = JSON.stringify({ roles: [{ role: "read", db: "admin", isBuiltin: true, privileges: [], roles: [] }] });

describe("createUsersRolesView init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("loads both users and roles", async () => {
    listUsers.mockResolvedValueOnce(usersJson);
    listRoles.mockResolvedValueOnce(rolesJson);
    const v = createUsersRolesView("conn:1");
    await v.init();
    expect(v.users).toHaveLength(1);
    expect(v.roles).toHaveLength(1);
    expect(v.usersError).toBeNull();
    expect(v.rolesError).toBeNull();
  });

  it("loadUsers failing does not prevent roles from loading", async () => {
    listUsers.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    listRoles.mockResolvedValueOnce(rolesJson);
    const v = createUsersRolesView("conn:1");
    await v.init();
    expect(v.usersError).toContain("not authorized");
    expect(v.roles).toHaveLength(1);
    expect(v.rolesError).toBeNull();
  });

  it("loadRoles failing does not prevent users from loading", async () => {
    listUsers.mockResolvedValueOnce(usersJson);
    listRoles.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    const v = createUsersRolesView("conn:1");
    await v.init();
    expect(v.users).toHaveLength(1);
    expect(v.usersError).toBeNull();
    expect(v.rolesError).toContain("not authorized");
  });

  it("defaults rolesDb to admin", () => {
    listUsers.mockResolvedValue(usersJson);
    listRoles.mockResolvedValue(rolesJson);
    const v = createUsersRolesView("conn:1");
    expect(v.rolesDb).toBe("admin");
  });
});

describe("createUsersRolesView loadRoles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue(usersJson);
  });

  it("re-fetches for the given db and updates rolesDb", async () => {
    listRoles.mockResolvedValueOnce(rolesJson);
    const v = createUsersRolesView("conn:1");
    await v.loadRoles("shop");
    expect(listRoles).toHaveBeenCalledWith("conn:1", "shop");
    expect(v.rolesDb).toBe("shop");
  });
});

describe("createUsersRolesView user mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue(usersJson);
    listRoles.mockResolvedValue(rolesJson);
  });

  it("createUser: valid input → api called, users refetched", async () => {
    const v = createUsersRolesView("conn:1");
    await v.createUser("admin", "bob", "pw", "[]");
    expect(createUser).toHaveBeenCalledWith("conn:1", "admin", "bob", "pw", "[]");
    expect(listUsers).toHaveBeenCalled();
  });

  it("createUser: empty username → throws, api not called", async () => {
    const v = createUsersRolesView("conn:1");
    await expect(v.createUser("admin", "", "pw", "[]")).rejects.toBe("err_username_empty");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("createUser: invalid roles JSON → throws, api not called", async () => {
    const v = createUsersRolesView("conn:1");
    await expect(v.createUser("admin", "bob", "pw", "{bad")).rejects.toBe("err_roles_invalid_json");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("updateUserRoles: calls api and refetches users", async () => {
    const v = createUsersRolesView("conn:1");
    await v.updateUserRoles("admin", "alice", '[{"role":"read","db":"shop"}]');
    expect(updateUserRoles).toHaveBeenCalledWith("conn:1", "admin", "alice", '[{"role":"read","db":"shop"}]');
    expect(listUsers).toHaveBeenCalled();
  });

  it("changeUserPassword: calls api, does not refetch users", async () => {
    const v = createUsersRolesView("conn:1");
    await v.changeUserPassword("admin", "alice", "newpw");
    expect(changeUserPassword).toHaveBeenCalledWith("conn:1", "admin", "alice", "newpw");
  });

  it("dropUser: calls api and refetches users", async () => {
    const v = createUsersRolesView("conn:1");
    await v.dropUser("admin", "alice");
    expect(dropUser).toHaveBeenCalledWith("conn:1", "admin", "alice");
    expect(listUsers).toHaveBeenCalled();
  });

  it("dropUser: server error sets usersError, does not throw", async () => {
    dropUser.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    const v = createUsersRolesView("conn:1");
    await expect(v.dropUser("admin", "alice")).resolves.toBeUndefined();
    expect(v.usersError).toContain("not authorized");
  });

  it("createUser: server error sets no state, rethrows for the form to catch", async () => {
    createUser.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    const v = createUsersRolesView("conn:1");
    await expect(v.createUser("admin", "bob", "pw", "[]")).rejects.toMatchObject({ message: "not authorized" });
  });
});

describe("createUsersRolesView role mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue(usersJson);
    listRoles.mockResolvedValue(rolesJson);
  });

  it("createRole: valid input → api called, roles refetched for that db", async () => {
    const v = createUsersRolesView("conn:1");
    await v.createRole("shop", "reportViewer", "[]", "[]");
    expect(createRole).toHaveBeenCalledWith("conn:1", "shop", "reportViewer", "[]", "[]");
    expect(listRoles).toHaveBeenCalledWith("conn:1", "shop");
  });

  it("createRole: empty role name → throws, api not called", async () => {
    const v = createUsersRolesView("conn:1");
    await expect(v.createRole("admin", "", "[]", "[]")).rejects.toBe("err_role_name_empty");
    expect(createRole).not.toHaveBeenCalled();
  });

  it("createRole: invalid privileges JSON → throws, api not called", async () => {
    const v = createUsersRolesView("conn:1");
    await expect(v.createRole("admin", "r", "[1,", "[]")).rejects.toBe("err_privileges_invalid_json");
    expect(createRole).not.toHaveBeenCalled();
  });

  it("updateRole: calls api and refetches roles", async () => {
    const v = createUsersRolesView("conn:1");
    await v.updateRole("admin", "read", "[]", "[]");
    expect(updateRole).toHaveBeenCalledWith("conn:1", "admin", "read", "[]", "[]");
    expect(listRoles).toHaveBeenCalledWith("conn:1", "admin");
  });

  it("dropRole: calls api and refetches roles", async () => {
    const v = createUsersRolesView("conn:1");
    await v.dropRole("admin", "read");
    expect(dropRole).toHaveBeenCalledWith("conn:1", "admin", "read");
    expect(listRoles).toHaveBeenCalledWith("conn:1", "admin");
  });

  it("dropRole: server error sets rolesError, does not throw", async () => {
    dropRole.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    const v = createUsersRolesView("conn:1");
    await expect(v.dropRole("admin", "read")).resolves.toBeUndefined();
    expect(v.rolesError).toContain("not authorized");
  });
});

describe("createUsersRolesView command log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue(usersJson);
    listRoles.mockResolvedValue(rolesJson);
    commandLog.clear();
  });

  it("createUser masks the password in the logged command", async () => {
    const v = createUsersRolesView("conn:1");
    await v.createUser("admin", "bob", "supersecret", "[]");
    const entry = commandLog.entries.find((e) => e.text.includes("createUser"));
    expect(entry).toBeDefined();
    expect(entry!.text).toContain('pwd: "***"');
    expect(entry!.text).not.toContain("supersecret");
  });
});
