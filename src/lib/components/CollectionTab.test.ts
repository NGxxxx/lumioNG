import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

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
import { navigation } from "../stores/navigation.svelte";

describe("CollectionTab", () => {
  beforeEach(() => navigation.setCollectionSection("info"));

  it("defaults to Info: Create index button absent; clicking Indexes shows it", async () => {
    const { getByText, queryByText } = render(CollectionTab, { props: { db: "d", coll: "c" } });
    expect(queryByText("＋ Create index")).toBeNull();
    await fireEvent.click(getByText("Indexes"));
    expect(getByText("＋ Create index")).toBeTruthy();
  });
});
