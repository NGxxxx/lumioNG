import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/connection", () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  listNamespaces: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/mongoServer", () => ({
  serverStatus: vi.fn().mockResolvedValue("{}"),
  buildInfo: vi.fn().mockResolvedValue("{}"),
  hostInfo: vi.fn().mockResolvedValue("{}"),
}));
vi.mock("../stores/collectionInfo.svelte", () => ({
  createCollectionInfo: () => ({ init() {}, error: null, loading: false, stats: null, options: null }),
}));
vi.mock("../stores/indexView.svelte", () => ({
  createIndexView: () => ({ init() {}, error: null, loading: false, indexes: [], create: vi.fn(), drop: vi.fn() }),
}));
vi.mock("../stores/collectionSchema.svelte", () => ({
  createCollectionSchema: () => ({ init: vi.fn(), refresh: vi.fn(), setSampleSize: vi.fn(), fields: [], sampleSize: 100, actualSampled: 0, error: null, loading: false }),
}));

import CollectionTab from "./CollectionTab.svelte";
import { sessionManager } from "../stores/sessionManager.svelte";

describe("CollectionTab", () => {
  beforeEach(async () => {
    // Ensure exactly one active session whose nav defaults to the Info section.
    for (const s of [...sessionManager.sessions]) await sessionManager.closeSession(s.id);
    await sessionManager.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
    sessionManager.active!.nav.setCollectionSection("info");
  });

  it("defaults to Info: Create index button absent; clicking Indexes shows it", async () => {
    const { getByText, queryByText } = render(CollectionTab, { props: { db: "d", coll: "c" } });
    expect(queryByText("＋ Create index")).toBeNull();
    await fireEvent.click(getByText("Indexes"));
    expect(getByText("＋ Create index")).toBeTruthy();
  });
});
