// src/lib/components/Toolbar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Toolbar from "./Toolbar.svelte";
import { toolbarFor } from "../domain/toolbarLayout";
import type { Command, CommandId } from "../domain/commands";

function cmd(disabled = false, run: () => void = vi.fn()): Command {
  return { disabled, run };
}

const labels: Partial<Record<CommandId, string>> = {
  "file.refresh": "Refresh",
  "file.import": "Import",
  "file.export": "Export",
  "query.aggregate": "Aggregate",
  "grid.focusFilter": "Find",
  "view.toggleWrap": "Wrap long lines",
  "view.toggleSavedQueries": "Saved queries",
  "file.newDocument": "New document",
  "query.run": "Run query",
};

function commands(overrides: Partial<Record<CommandId, Command>> = {}): Partial<Record<CommandId, Command>> {
  return {
    "file.refresh": cmd(),
    "file.import": cmd(),
    "file.export": cmd(),
    "query.aggregate": cmd(),
    "grid.focusFilter": cmd(),
    "view.toggleWrap": cmd(),
    "view.toggleSavedQueries": cmd(),
    "file.newDocument": cmd(),
    "query.run": cmd(),
    ...overrides,
  };
}

const dataProps = () => ({ entries: toolbarFor("collection.data"), labels, commands: commands() });

describe("Toolbar", () => {
  it("shows only the data view's actions, with New document as the primary button", () => {
    const { getByRole, queryByRole } = render(Toolbar, { props: dataProps() });
    for (const name of ["Refresh", "Import", "Export"]) expect(getByRole("button", { name })).toBeTruthy();
    const primary = getByRole("button", { name: "New document" });
    expect(primary.classList.contains("primary")).toBe(true);
    expect(queryByRole("button", { name: "Run query" })).toBeNull();
    // overflow entries are not rendered inline
    expect(queryByRole("button", { name: "Aggregate" })).toBeNull();
  });

  it("clicking an action runs its command", async () => {
    const run = vi.fn();
    const { getByRole } = render(Toolbar, { props: { ...dataProps(), commands: commands({ "file.refresh": cmd(false, run) }) } });
    await fireEvent.click(getByRole("button", { name: "Refresh" }));
    expect(run).toHaveBeenCalled();
  });

  it("a disabled command renders a disabled button", () => {
    const { getByRole } = render(Toolbar, { props: { ...dataProps(), commands: commands({ "file.import": cmd(true) }) } });
    expect((getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the ⋯ button opens a menu with the overflow actions, which run their commands", async () => {
    const run = vi.fn();
    const { getByRole } = render(Toolbar, { props: { ...dataProps(), commands: commands({ "query.aggregate": cmd(false, run) }) } });
    await fireEvent.click(getByRole("button", { name: "More actions" }));
    await fireEvent.click(getByRole("menuitem", { name: /Aggregate/ }));
    expect(run).toHaveBeenCalled();
  });

  it("toggle commands in activeIds render pressed / checked", async () => {
    const { getByRole } = render(Toolbar, {
      props: { ...dataProps(), activeIds: new Set<CommandId>(["view.toggleWrap"]) },
    });
    await fireEvent.click(getByRole("button", { name: "More actions" }));
    expect(getByRole("menuitemcheckbox", { name: /Wrap long lines/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("no actions and no ⋯ button for the query view", () => {
    const { queryAllByRole } = render(Toolbar, { props: { entries: toolbarFor("query"), labels, commands: commands() } });
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  it("renders the context breadcrumb with the last segment emphasized", () => {
    const { container } = render(Toolbar, { props: { ...dataProps(), crumb: ["shop", "orders"] } });
    const parts = [...container.querySelectorAll(".crumb > span:not(.slash)")];
    expect(parts.map((p) => p.textContent)).toEqual(["shop", "orders"]);
    expect(parts[1].classList.contains("strong")).toBe(true);
    expect(container.querySelectorAll(".crumb .slash")).toHaveLength(1);
  });

  it("Escape closes the ⋯ menu and returns focus to its button", async () => {
    const { getByRole, queryByRole } = render(Toolbar, { props: dataProps() });
    const more = getByRole("button", { name: "More actions" });
    await fireEvent.click(more);
    const menu = getByRole("menu");
    await fireEvent.keyDown(menu, { key: "Escape" });
    expect(queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("ArrowDown moves focus through the ⋯ menu items", async () => {
    const { getByRole, getAllByRole } = render(Toolbar, { props: dataProps() });
    await fireEvent.click(getByRole("button", { name: "More actions" }));
    const items = [...getByRole("menu").querySelectorAll("button")];
    expect(document.activeElement).toBe(items[0]);
    await fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    void getAllByRole;
  });
});
