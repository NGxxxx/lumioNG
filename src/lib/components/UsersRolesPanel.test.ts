import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { UserInfo, RoleInfo } from "../domain/users";

let mockUsers: UserInfo[] = [];
let mockRoles: RoleInfo[] = [];
const init = vi.fn();

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: {
    get active() {
      return { id: "conn:1", readOnly: false };
    },
  },
}));

vi.mock("../stores/usersRoles.svelte", () => ({
  createUsersRolesView: () => ({
    get users() { return mockUsers; },
    get usersError() { return null; },
    get usersLoading() { return false; },
    get roles() { return mockRoles; },
    get rolesError() { return null; },
    get rolesLoading() { return false; },
    get rolesDb() { return "admin"; },
    init,
    loadUsers: vi.fn(),
    loadRoles: vi.fn(),
    createUser: vi.fn(),
    updateUserRoles: vi.fn(),
    changeUserPassword: vi.fn(),
    dropUser: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    dropRole: vi.fn(),
  }),
}));

import UsersRolesPanel from "./UsersRolesPanel.svelte";

describe("UsersRolesPanel", () => {
  it("loads on mount and defaults to the Users tab", () => {
    mockUsers = [{ user: "alice", db: "admin", roles: [] }];
    const { getByText } = render(UsersRolesPanel);
    expect(init).toHaveBeenCalled();
    expect(getByText("alice")).toBeTruthy();
  });

  it("switching to the Roles toggle renders the roles list", async () => {
    // Scoped to role="button" because UserList's "Roles" table column header
    // is also on screen at this point, making a plain getByText("Roles") ambiguous.
    const { getByText, getByRole } = render(UsersRolesPanel);
    mockRoles = [{ role: "read", db: "admin", isBuiltin: true, privileges: [], roles: [] }];
    const { fireEvent } = await import("@testing-library/svelte");
    await fireEvent.click(getByRole("button", { name: "Roles" }));
    expect(getByText("read")).toBeTruthy();
  });
});
