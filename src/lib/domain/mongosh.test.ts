import { describe, it, expect } from "vitest";
import { updateOneCmd, listIndexesCmd, listDatabasesCmd, findOneByIdCmd } from "./mongosh";

describe("write command-log helpers", () => {
  it("updateOneCmd", () => {
    expect(updateOneCmd("c", '{ "a": 1 }', '{ "$set": { "b": 2 } }')).toBe(
      'db.getCollection("c").updateOne({ "a": 1 }, { "$set": { "b": 2 } })',
    );
  });
});

describe("read command-log helpers", () => {
  it("listIndexesCmd", () => {
    expect(listIndexesCmd("orders")).toBe('db.getCollection("orders").getIndexes()');
  });
  it("listDatabasesCmd", () => {
    expect(listDatabasesCmd()).toBe("show dbs");
  });
  it("findOneByIdCmd", () => {
    expect(findOneByIdCmd("orders", '{"$oid":"a"}')).toBe(
      'db.getCollection("orders").findOne({ "_id": {"$oid":"a"} })',
    );
  });
});

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
} from "./mongosh";

describe("users/roles mongosh commands", () => {
  it("listUsersCmd", () => {
    expect(listUsersCmd()).toBe(
      'db.getSiblingDB("admin").runCommand({ usersInfo: 1, forAllDBs: true })',
    );
  });

  it("createUserCmd masks the password", () => {
    const cmd = createUserCmd("admin", "alice", '[{"role":"read","db":"shop"}]');
    expect(cmd).toBe(
      'db.getSiblingDB("admin").createUser({ user: "alice", pwd: "***", roles: [{"role":"read","db":"shop"}] })',
    );
    expect(cmd).not.toContain("pwd: \"secret");
  });

  it("updateUserRolesCmd", () => {
    expect(updateUserRolesCmd("admin", "alice", "[]")).toBe(
      'db.getSiblingDB("admin").updateUser("alice", { roles: [] })',
    );
  });

  it("changeUserPasswordCmd masks the password", () => {
    expect(changeUserPasswordCmd("admin", "alice")).toBe(
      'db.getSiblingDB("admin").updateUser("alice", { pwd: "***" })',
    );
  });

  it("dropUserCmd", () => {
    expect(dropUserCmd("admin", "alice")).toBe('db.getSiblingDB("admin").dropUser("alice")');
  });

  it("listRolesCmd", () => {
    expect(listRolesCmd("admin")).toBe(
      'db.getSiblingDB("admin").runCommand({ rolesInfo: 1, showPrivileges: true, showBuiltinRoles: true })',
    );
  });

  it("createRoleCmd", () => {
    expect(createRoleCmd("admin", "reportViewer", "[]", "[]")).toBe(
      'db.getSiblingDB("admin").createRole({ role: "reportViewer", privileges: [], roles: [] })',
    );
  });

  it("updateRoleCmd", () => {
    expect(updateRoleCmd("admin", "reportViewer", "[]", "[]")).toBe(
      'db.getSiblingDB("admin").updateRole("reportViewer", { privileges: [], roles: [] })',
    );
  });

  it("dropRoleCmd", () => {
    expect(dropRoleCmd("admin", "reportViewer")).toBe(
      'db.getSiblingDB("admin").dropRole("reportViewer")',
    );
  });
});
