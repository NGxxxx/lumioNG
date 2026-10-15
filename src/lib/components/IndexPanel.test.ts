import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

let mockIndexes: import("../domain/indexes").IndexInfo[] = [];
let droppedNames: string[] = [];
vi.mock("../stores/indexView.svelte", async () => {
  const { createDestructiveGate } = await vi.importActual<typeof import("../stores/destructiveGate.svelte")>("../stores/destructiveGate.svelte");
  return { createIndexView: () => {
  const drop = async (name: string) => { droppedNames.push(name); };
  const destructive = createDestructiveGate(() => "");
  return {
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
    drop,
    requestDrop: (name: string) => destructive.request({ op: "dropIndex", target: { db: "d", coll: "c", index: name } }, () => drop(name)),
    destructive,
  };
} };
});

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
    expect(getByText(/Type email_1 to confirm/)).toBeTruthy();
    handleModalKeydown({ key: "Escape", target: null } as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(queryByText(/Type email_1 to confirm/)).toBeNull());
    expect(droppedNames).toEqual([]);
  });

  it("Enter confirms the drop once the index name is typed", async () => {
    droppedNames = [];
    mockIndexes = [
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false },
    ];
    const { getByText, getByLabelText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    await fireEvent.click(getByText("Drop"));
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    expect(droppedNames).toEqual([]);
    await fireEvent.input(getByLabelText(/Type email_1 to confirm/), { target: { value: "email_1" } });
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(droppedNames).toEqual(["email_1"]));
  });
});
