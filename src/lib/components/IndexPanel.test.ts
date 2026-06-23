import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";

let mockIndexes: import("../domain/indexes").IndexInfo[] = [];
vi.mock("../stores/indexView.svelte", () => ({
  createIndexView: () => ({
    get indexes() {
      return mockIndexes;
    },
    get error() {
      return null;
    },
    get loading() {
      return false;
    },
    init: vi.fn(),
    refresh: vi.fn(),
    create: vi.fn(),
    drop: vi.fn(),
  }),
}));

import IndexPanel from "./IndexPanel.svelte";

describe("IndexPanel", () => {
  it("Drop button disabled for _id_, enabled for other indexes", () => {
    mockIndexes = [
      { name: "_id_", entries: [{ field: "_id", value: 1 }], unique: false, sparse: false, ttl: null, isId: true },
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false },
    ];
    const { getAllByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    const drops = getAllByText("Drop") as HTMLButtonElement[];
    expect(drops[0].disabled).toBe(true);
    expect(drops[1].disabled).toBe(false);
  });
});
