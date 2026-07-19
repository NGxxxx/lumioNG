import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { handleModalKeydown } from "$lib/stores/modalStack";

let mockIndexes: import("../domain/indexes").IndexInfo[] = [];
let droppedNames: string[] = [];
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
    drop: async (name: string) => { droppedNames.push(name); },
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

  it("Escape dismisses the drop-confirm popup without dropping", async () => {
    droppedNames = [];
    mockIndexes = [
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false },
    ];
    const { getByText, queryByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await fireEvent.click(getByText("Drop"));
    expect(getByText("Drop index?")).toBeTruthy();
    handleModalKeydown({ key: "Escape", target: null } as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(queryByText("Drop index?")).toBeNull());
    expect(droppedNames).toEqual([]);
  });

  it("Enter confirms the drop", async () => {
    droppedNames = [];
    mockIndexes = [
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false },
    ];
    const { getByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await fireEvent.click(getByText("Drop"));
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(droppedNames).toEqual(["email_1"]));
  });
});
