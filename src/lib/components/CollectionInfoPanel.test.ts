import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { CollStatsInfo, CollOptionsInfo } from "../domain/stats";

let mockStats: CollStatsInfo | null = null;
let mockOptions: CollOptionsInfo | null = null;
vi.mock("../stores/collectionInfo.svelte", () => ({
  createCollectionInfo: () => ({
    get stats() {
      return mockStats;
    },
    get options() {
      return mockOptions;
    },
    get error() {
      return null;
    },
    get loading() {
      return false;
    },
    init: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import CollectionInfoPanel from "./CollectionInfoPanel.svelte";

describe("CollectionInfoPanel", () => {
  it("hiện 'Không có validator' khi validatorJson null", () => {
    mockStats = {
      ns: "d.c",
      count: 3,
      size: 100,
      avgObjSize: 33,
      storageSize: 200,
      totalIndexSize: 50,
      nindexes: 1,
      indexSizes: [{ name: "_id_", bytes: 50 }],
      capped: false,
    };
    mockOptions = {
      capped: false,
      size: null,
      max: null,
      validationLevel: null,
      validationAction: null,
      validatorJson: null,
      rawJson: "{}",
    };
    const { getByText } = render(CollectionInfoPanel, { props: { db: "d", coll: "c" } });
    expect(getByText("Không có validator")).toBeTruthy();
  });

  it("hiện capped options + raw options khi có", () => {
    mockStats = {
      ns: "d.c",
      count: 0,
      size: 0,
      avgObjSize: null,
      storageSize: 0,
      totalIndexSize: 0,
      nindexes: 1,
      indexSizes: [],
      capped: true,
    };
    mockOptions = {
      capped: true,
      size: 1048576,
      max: 1000,
      validationLevel: null,
      validationAction: null,
      validatorJson: null,
      rawJson: '{\n  "capped": true\n}',
    };
    const { getByText } = render(CollectionInfoPanel, { props: { db: "d", coll: "c" } });
    expect(getByText("Raw options")).toBeTruthy();
    expect(getByText("Max documents")).toBeTruthy();
  });
});
