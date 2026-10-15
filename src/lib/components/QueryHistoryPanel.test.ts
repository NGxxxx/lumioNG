import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import QueryHistoryPanel from "./QueryHistoryPanel.svelte";
import type { HistoryEntry } from "../domain/queryHistory";

const now = Date.now();
const E = (id: string, script: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id, tabId: 1, sessionLabel: "staging", connId: 2, db: "shop", script, at: now, ms: 12, outcome: { kind: "docs", n: 3 }, runs: 1, ...over,
});

function setup(entries: HistoryEntry[]) {
  const props = { entries, tabId: 1, onload: vi.fn(), onopen: vi.fn(), onclear: vi.fn(), onclose: vi.fn() };
  return { props, ...render(QueryHistoryPanel, { props }) };
}

describe("QueryHistoryPanel", () => {
  const entries = [
    E("a", "db.orders.find({status: 'x'})"),
    E("b", "db.users.find()", { tabId: 2, outcome: { kind: "error", message: "boom" } }),
    E("c", "db.old.find()", { at: now - 10 * 86_400_000 }),
  ];

  it("groups by day and shows outcomes", () => {
    const { getByText, getAllByText } = setup(entries);
    expect(getByText("Today")).toBeTruthy();
    expect(getByText("Older")).toBeTruthy();
    expect(getByText("boom")).toBeTruthy();
    expect(getAllByText("3 docs").length).toBe(2);
  });

  it("search, This tab and Errors only narrow the list", async () => {
    const { getByLabelText, getByRole, queryByText } = setup(entries);
    await fireEvent.input(getByLabelText("Search history"), { target: { value: "users" } });
    expect(queryByText("db.orders.find({status: 'x'})")).toBeNull();
    await fireEvent.input(getByLabelText("Search history"), { target: { value: "" } });
    await fireEvent.click(getByRole("radio", { name: "This tab" }));
    expect(queryByText("db.users.find()")).toBeNull();
    await fireEvent.click(getByRole("radio", { name: "All" }));
    await fireEvent.click(getByLabelText(/Errors only/));
    expect(queryByText("db.orders.find({status: 'x'})")).toBeNull();
    expect(queryByText("db.users.find()")).toBeTruthy();
  });

  it("expanding an entry offers Load and Open in new tab", async () => {
    const { getByText, getByRole, props } = setup(entries);
    await fireEvent.click(getByText("db.orders.find({status: 'x'})"));
    await fireEvent.click(getByRole("button", { name: "Load" }));
    expect(props.onload).toHaveBeenCalledWith(entries[0]);
    await fireEvent.click(getByRole("button", { name: "Open in new tab" }));
    expect(props.onopen).toHaveBeenCalledWith(entries[0]);
  });
});
