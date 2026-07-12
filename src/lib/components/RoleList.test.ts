import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { RoleInfo } from "../domain/users";

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
    get roles() { return (overrides.roles as RoleInfo[]) ?? []; },
    get rolesError() { return (overrides.rolesError as string | null) ?? null; },
    get rolesLoading() { return (overrides.rolesLoading as boolean) ?? false; },
    get rolesDb() { return (overrides.rolesDb as string) ?? "admin"; },
    loadRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    dropRole: vi.fn(),
  };
}

import RoleList from "./RoleList.svelte";

describe("RoleList", () => {
  it("renders one row per role with a Built-in badge", () => {
    const view = makeView({
      roles: [
        { role: "read", db: "admin", isBuiltin: true, privileges: [], roles: [] },
        { role: "reportViewer", db: "admin", isBuiltin: false, privileges: [{ a: 1 }], roles: [] },
      ],
    });
    const { getByText, getAllByText } = render(RoleList, { props: { view, readOnly: false } });
    expect(getByText("read")).toBeTruthy();
    expect(getByText("reportViewer")).toBeTruthy();
    expect(getAllByText("✓")).toHaveLength(1);
  });

  it("Drop is disabled for built-in roles", () => {
    const view = makeView({
      roles: [{ role: "read", db: "admin", isBuiltin: true, privileges: [], roles: [] }],
    });
    const { getByText } = render(RoleList, { props: { view, readOnly: false } });
    expect((getByText("Drop") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Refresh calls loadRoles with the Database field's current value", async () => {
    const view = makeView();
    const { getByText, getByLabelText } = render(RoleList, { props: { view, readOnly: false } });
    await fireEvent.input(getByLabelText("Database"), { target: { value: "shop" } });
    await fireEvent.click(getByText("Refresh"));
    expect(view.loadRoles).toHaveBeenCalledWith("shop");
  });

  it("Create role form submits with the entered fields", async () => {
    const view = makeView();
    const { getByText, getByLabelText } = render(RoleList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("＋ Create role"));
    await fireEvent.input(getByLabelText("Role name"), { target: { value: "reportViewer" } });
    await fireEvent.click(getByText("Create"));
    expect(view.createRole).toHaveBeenCalledWith("admin", "reportViewer", "[]", "[]");
  });

  it("Edit opens pre-filled with the role's current privileges and inherited roles, submitted unchanged", async () => {
    const view = makeView({
      roles: [{ role: "reportViewer", db: "admin", isBuiltin: false, privileges: [{ actions: ["find"] }], roles: [{ role: "read", db: "shop" }] }],
    });
    const { getByText, container } = render(RoleList, { props: { view, readOnly: false } });
    await fireEvent.click(getByText("Edit"));
    // CodeEditor has no form label; verify the pre-filled JSON rendered into the CodeMirror content.
    expect(container.textContent).toContain('"actions":["find"]');
    expect(container.textContent).toContain('"role":"read"');
    await fireEvent.click(getByText("Save"));
    expect(view.updateRole).toHaveBeenCalledWith("admin", "reportViewer", '[{"actions":["find"]}]', '[{"role":"read","db":"shop"}]');
  });

  it("readOnly disables Create/Edit buttons and keeps built-in Drop disabled", () => {
    const view = makeView({
      roles: [{ role: "reportViewer", db: "admin", isBuiltin: false, privileges: [], roles: [] }],
    });
    const { getByText } = render(RoleList, { props: { view, readOnly: true } });
    expect((getByText("＋ Create role") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Edit") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Drop") as HTMLButtonElement).disabled).toBe(true);
  });
});
