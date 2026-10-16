import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";

vi.mock("../api/connection", () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  listNamespaces: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/documents", () => ({
  queryPage: vi.fn().mockResolvedValue([{ _id: 1, name: "a" }]),
  sampleDocuments: vi.fn().mockResolvedValue([{ _id: 1, name: "a" }]),
  countDocuments: vi.fn().mockResolvedValue(1),
  fetchFullDoc: vi.fn(),
  updateOne: vi.fn(),
  exportQueryProgress: vi.fn(),
}));
vi.mock("../api/indexes", () => ({ listIndexes: vi.fn().mockResolvedValue([]) }));

import ResultTable from "./ResultTable.svelte";
import { sessionManager } from "../stores/sessionManager.svelte";
import { viewPresets } from "../stores/viewPresets.svelte";
import { queryPage } from "../api/documents";

describe("ResultTable (collection data view)", () => {
  beforeEach(async () => {
    for (const s of [...sessionManager.sessions]) await sessionManager.closeSession(s.id);
    await sessionManager.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
  });

  it("forwards the store's last query time to the pager", async () => {
    const { container } = render(ResultTable, { props: { db: "d", coll: "c", version: 0, onopendocument: () => {} } });
    await waitFor(() => expect(container.querySelector(".pg-time")).toBeTruthy());
    expect(container.querySelector(".pg-time")!.textContent).toMatch(/\d+ ms/);
  });

  it("Views: save the current view, then apply it from the list", async () => {
    for (const p of viewPresets.list("conn:1/d/c")) viewPresets.remove("conn:1/d/c", p.name);
    const { getByText, getByPlaceholderText, container } = render(ResultTable, { props: { db: "d", coll: "c", version: 0, onopendocument: () => {} } });
    await waitFor(() => expect(container.querySelector(".pg-time")).toBeTruthy());
    await fireEvent.click(getByText(/^Views/));
    expect(getByText("No saved views yet")).toBeTruthy();
    await fireEvent.input(getByPlaceholderText("Save current view as…"), { target: { value: "Everything" } });
    await fireEvent.submit(container.querySelector("form.dd-save")!);
    expect(getByText("Everything")).toBeTruthy();
    const calls = (queryPage as ReturnType<typeof vi.fn>).mock.calls.length;
    await fireEvent.click(getByText("Everything"));
    await waitFor(() => expect((queryPage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
