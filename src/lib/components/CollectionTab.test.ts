import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";

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
  createIndexView: () => ({
    init() {}, error: null, loading: false, indexes: [], rows: [], summary: { count: 0, bytes: 0 }, dataDays: null, since: null,
    usageError: null, traits: { canHide: true, topology: null, host: null }, pendingHide: null, dropAdvice: null,
    create: vi.fn(), drop: vi.fn(), requestDrop: vi.fn(), destructive: { pending: null },
  }),
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
    sessionManager.active!.nav.selectCollection("d", "c");
    sessionManager.active!.nav.setCollectionView("info");
  });

  it("renders the view chosen in nav: Info has no Create index; Indexes shows it", async () => {
    const { getByText, queryByText, queryByRole } = render(CollectionTab, { props: { db: "d", coll: "c" } });
    expect(queryByText("＋ Create index")).toBeNull();
    expect(queryByRole("button", { name: "Indexes" })).toBeNull(); // no own sub-tab strip
    sessionManager.active!.nav.setCollectionView("indexes");
    await tick();
    expect(getByText("＋ Create index")).toBeTruthy();
  });
});
