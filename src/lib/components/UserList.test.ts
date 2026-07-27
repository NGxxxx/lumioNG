import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { UserInfo } from "../domain/users";

// CodeEditor (CodeMirror) measures ranges; jsdom doesn't implement these. Stub them so it mounts
// (same stub as CodeEditor.test.ts).
beforeAll(() => {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  (Range.prototype as unknown as { getClientRects: () => unknown }).getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
  (Range.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => rect;
});

function makeView(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    get users() { return (overrides.users as UserInfo[]) ?? []; },
    get usersError() { return (overrides.usersError as string | null) ?? null; },
    get usersLoading() { return (overrides.usersLoading as boolean) ?? false; },
    createUser: vi.fn(),
    updateUserRoles: vi.fn(),
    changeUserPassword: vi.fn(),
    dropUser: vi.fn(),
  };
}

import UserList from "./UserList.svelte";

describe("UserList", () => {
  it("renders one row per user with their roles", () => {
    const view = makeView({
      users: [{ user: "alice", db: "admin", roles: [{ role: "readWrite", db: "shop" }] }],
    });
    const { getByText } = render(UserList, { props: { view, readOnly: false } });
    expect(getByText("alice")).toBeTruthy();
    expect(getByText("readWrite@shop")).toBeTruthy();
  });

  it("shows the error banner when usersError is set", () => {
    const view = makeView({ usersError: "Query: not authorized" });
    const { getByText } = render(UserList, { props: { view, readOnly: false } });
    expect(getByText("Query: not authorized")).toBeTruthy();
  });

  it("Create user form submits with the entered fields", async () => {
    const view = makeView();
    const { getByText, getByLabelText } = render(UserList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("＋ Create user"));
    await fireEvent.input(getByLabelText("Username"), { target: { value: "bob" } });
    await fireEvent.input(getByLabelText("Password"), { target: { value: "pw" } });
    await fireEvent.click(getByText("Create"));
    expect(view.createUser).toHaveBeenCalledWith("admin", "bob", "pw", "[]");
  });

  it("Drop asks for confirmation before calling dropUser", async () => {
    const view = makeView({ users: [{ user: "alice", db: "admin", roles: [] }] });
    const { getByText } = render(UserList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("Drop"));
    expect(getByText("Drop user?")).toBeTruthy();
    expect(view.dropUser).not.toHaveBeenCalled();
    await fireEvent.click(getByText("Drop user?").closest(".modal")!.querySelector(".danger")!);
    expect(view.dropUser).toHaveBeenCalledWith("admin", "alice");
  });

  it("Change password modal never pre-fills a value and submits only the new password", async () => {
    const view = makeView({ users: [{ user: "alice", db: "admin", roles: [] }] });
    const { getByText, getByLabelText } = render(UserList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("Change password"));
    const input = getByLabelText("New password") as HTMLInputElement;
    expect(input.value).toBe("");
    await fireEvent.input(input, { target: { value: "newpw" } });
    await fireEvent.click(getByText("Save"));
    expect(view.changeUserPassword).toHaveBeenCalledWith("admin", "alice", "newpw");
  });

  it("Edit roles opens pre-filled with the user's current roles and submits them unchanged", async () => {
    const view = makeView({
      users: [{ user: "alice", db: "admin", roles: [{ role: "read", db: "shop" }] }],
    });
    const { getByText, baseElement } = render(UserList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("Edit roles"));
    // CodeEditor has no form label; verify the pre-filled JSON rendered into the CodeMirror content.
    // baseElement, not container: the shared Modal portals the dialog to document.body.
    expect(baseElement.textContent).toContain('"role":"read"');
    await fireEvent.click(getByText("Save"));
    expect(view.updateUserRoles).toHaveBeenCalledWith("admin", "alice", '[{"role":"read","db":"shop"}]');
  });

  it("readOnly disables Create/Drop/Change password/Edit roles buttons", () => {
    const view = makeView({ users: [{ user: "alice", db: "admin", roles: [] }] });
    const { getByText } = render(UserList, { props: { view, readOnly: true } });
    expect((getByText("＋ Create user") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Drop") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Change password") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Edit roles") as HTMLButtonElement).disabled).toBe(true);
  });
});
