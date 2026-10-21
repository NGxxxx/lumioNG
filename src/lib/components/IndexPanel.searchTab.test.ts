import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

let mockUri = "mongodb://localhost:27017/?directConnection=true";
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { get active() { return { id: "conn:1", readOnly: false, uri: mockUri }; } },
}));
vi.mock("../stores/indexView.svelte", async () => {
  const { createDestructiveGate } = await vi.importActual<typeof import("../stores/destructiveGate.svelte")>("../stores/destructiveGate.svelte");
  return { createIndexView: () => ({
    indexes: [], rows: [], summary: { count: 0, bytes: 0 }, dataDays: null, since: null, usageError: null,
    traits: { canHide: true, topology: null, host: null }, pendingHide: null, dropAdvice: null,
    requestHide: vi.fn(), confirmHide: vi.fn(), cancelHide: vi.fn(), unhide: vi.fn(), hideInstead: vi.fn(), dropAnyway: vi.fn(), cancelDropAdvice: vi.fn(),
    error: null, loading: false, init: vi.fn(), refresh: vi.fn(), create: vi.fn(), drop: vi.fn(), requestDrop: vi.fn(),
    destructive: createDestructiveGate(() => ""),
  }) };
});
vi.mock("../api/searchIndexes", () => ({
  atlasVersion: vi.fn(), listSearchIndexes: vi.fn(async () => []), createSearchIndex: vi.fn(), updateSearchIndex: vi.fn(), dropSearchIndex: vi.fn(),
}));
vi.mock("../stores/commandLog.svelte", () => ({ commandLog: { pushTimed: vi.fn(async (_c: string, _s: string, fn: () => Promise<unknown>) => fn()) } }));

import * as api from "../api/searchIndexes";
import { atlasDetect } from "../stores/atlasDetect";
import IndexPanel from "./IndexPanel.svelte";

const searchTab = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[role=tab]")].find((t) => /search/i.test(t.textContent ?? ""));

beforeEach(() => {
  vi.clearAllMocks();
  atlasDetect.invalidate("conn:1");
  mockUri = "mongodb://localhost:27017/?directConnection=true";
});

describe("IndexPanel search index tab", () => {
  it("is hidden when the server is not Atlas", async () => {
    vi.mocked(api.atlasVersion).mockResolvedValue(null);
    const { container } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await waitFor(() => expect(api.atlasVersion).toHaveBeenCalled());
    expect(container.querySelector("[role=tablist]")).toBeNull();
    expect(searchTab(container)).toBeUndefined();
  });

  it("is hidden when the atlasVersion probe fails", async () => {
    vi.mocked(api.atlasVersion).mockRejectedValue(new Error("no"));
    const { container } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await waitFor(() => expect(api.atlasVersion).toHaveBeenCalled());
    expect(searchTab(container)).toBeUndefined();
  });

  it("shows for a *.mongodb.net host without probing", () => {
    mockUri = "mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/";
    const { container } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect(searchTab(container)).toBeDefined();
    expect(api.atlasVersion).not.toHaveBeenCalled();
  });

  it("shows when atlasVersion answers, and opening it lists the search indexes", async () => {
    vi.mocked(api.atlasVersion).mockResolvedValue("v20240101");
    vi.mocked(api.listSearchIndexes).mockResolvedValue([JSON.stringify({ name: "default", type: "search", status: "READY", queryable: true, latestDefinition: { mappings: { dynamic: true } } })]);
    const { container, findByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await waitFor(() => expect(searchTab(container)).toBeDefined());
    await fireEvent.click(searchTab(container)!);
    await findByText("default");
    expect(api.listSearchIndexes).toHaveBeenCalledWith("conn:1", "d", "c");
  });

  it("explains that a plain server cannot serve search indexes", async () => {
    mockUri = "mongodb://x.mongodb.net/";
    vi.mocked(api.listSearchIndexes).mockRejectedValue({ kind: "Query", message: "Using Atlas Search Database Commands and the $listSearchIndexes aggregation stage requires additional configuration." });
    const { container, findByRole } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await fireEvent.click(searchTab(container)!);
    expect((await findByRole("status")).textContent).toMatch(/does not support Atlas Search/);
  });
});
