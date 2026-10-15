import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

let mockIndexes: import("../domain/indexes").IndexInfo[] = [];
let droppedNames: string[] = [];
let mockStatus: Record<string, import("../domain/indexUsage").IndexStatus> = {};
let mockExtra: Record<string, unknown> = {};
let mockReadOnly = false;
const hideCalls: string[] = [];
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { get active() { return { id: "conn:1", readOnly: mockReadOnly }; } },
}));
vi.mock("../stores/indexView.svelte", async () => {
  const { createDestructiveGate } = await vi.importActual<typeof import("../stores/destructiveGate.svelte")>("../stores/destructiveGate.svelte");
  return { createIndexView: () => {
  const drop = async (name: string) => { droppedNames.push(name); };
  const destructive = createDestructiveGate(() => "");
  return {
    get indexes() {
      return mockIndexes;
    },
    get rows() {
      return mockIndexes.map((info) => ({
        info, usage: { name: info.name, ops: info.name === "email_1" ? 0 : 42, since: 0 }, size: 1024 * 1024,
        status: mockStatus[info.name] ?? (info.isId ? "protectedId" : "inUse"), redundantWith: null,
      }));
    },
    get summary() { return (mockExtra.summary as { count: number; bytes: number }) ?? { count: 0, bytes: 0 }; },
    get dataDays() { return (mockExtra.dataDays as number | null) ?? null; },
    get since() { return null; },
    get usageError() { return (mockExtra.usageError as string | null) ?? null; },
    get traits() { return (mockExtra.traits as object) ?? { canHide: true, topology: null, host: null }; },
    get pendingHide() { return null; },
    get dropAdvice() { return null; },
    requestHide: (name: string) => hideCalls.push(`hide:${name}`),
    confirmHide: vi.fn(),
    cancelHide: vi.fn(),
    unhide: (name: string) => hideCalls.push(`unhide:${name}`),
    hideInstead: vi.fn(),
    dropAnyway: vi.fn(),
    cancelDropAdvice: vi.fn(),
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

const I = (name: string, over: Partial<import("../domain/indexes").IndexInfo> = {}) => ({
  name, entries: [{ field: name.replace(/_1$/, ""), value: 1 }], unique: false, sparse: false, ttl: null,
  isId: name === "_id_", hidden: false, partial: false, collation: null, ...over,
});

describe("IndexPanel", () => {
  beforeEach(() => {
    mockStatus = {};
    mockExtra = {};
    mockReadOnly = false;
    hideCalls.length = 0;
  });

  it("shows size, uses, status and the unused summary", () => {
    mockIndexes = [I("_id_"), I("a_1")];
    mockStatus = { a_1: "unused" };
    mockExtra = { summary: { count: 1, bytes: 340 * 1024 * 1024 }, dataDays: 30 };
    const { getByText, getAllByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect(getByText("Unused")).toBeTruthy();
    expect(getByText("Required (_id)")).toBeTruthy();
    expect(getByText(/1 unused index using 340/)).toBeTruthy();
    expect(getAllByText("1.0 MB").length).toBe(2);
  });

  it("warns when there are fewer than 7 days of data, and notes replica counting", () => {
    mockIndexes = [I("a_1")];
    mockExtra = { dataDays: 3, traits: { canHide: true, topology: "replica", host: "db-1:27017" } };
    const { getByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect(getByText(/Only 3 days of usage data/)).toBeTruthy();
    expect(getByText(/counted on db-1:27017 only/)).toBeTruthy();
  });

  it("no $indexStats permission → uses column says so", () => {
    mockIndexes = [I("a_1")];
    mockExtra = { usageError: "Query: not authorized" };
    const { getByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect(getByText("Not permitted")).toBeTruthy();
  });

  it("Hide / Unhide; none for protected rows or read-only sessions; disabled below 4.4", async () => {
    mockIndexes = [I("a_1"), I("b_1", { hidden: true }), I("u_1", { unique: true })];
    mockStatus = { b_1: "hidden", u_1: "protectedUnique" };
    const a = render(IndexPanel, { props: { db: "d", coll: "c" } });
    const hides = a.getAllByRole("button", { name: "Hide" });
    expect(hides).toHaveLength(1);
    await fireEvent.click(hides[0]);
    await fireEvent.click(a.getByRole("button", { name: "Unhide" }));
    expect(hideCalls).toEqual(["hide:a_1", "unhide:b_1"]);
    a.unmount();
    mockExtra = { traits: { canHide: false, topology: null, host: null } };
    const b = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect((b.getByRole("button", { name: "Hide" }) as HTMLButtonElement).disabled).toBe(true);
    b.unmount();
    mockReadOnly = true;
    const c = render(IndexPanel, { props: { db: "d", coll: "c" } });
    expect(c.queryByRole("button", { name: "Hide" })).toBeNull();
    expect(c.queryByRole("button", { name: "Unhide" })).toBeNull();
  });

  it("Drop button disabled for _id_, enabled for other indexes", () => {
    mockIndexes = [
      { name: "_id_", entries: [{ field: "_id", value: 1 }], unique: false, sparse: false, ttl: null, isId: true, hidden: false, partial: false, collation: null },
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false, hidden: false, partial: false, collation: null },
    ];
    const { getAllByText } = render(IndexPanel, { props: { db: "d", coll: "c" } });
    const drops = getAllByText("Drop") as HTMLButtonElement[];
    expect(drops[0].disabled).toBe(true);
    expect(drops[1].disabled).toBe(false);
  });

  it("Escape dismisses the drop-confirm popup without dropping", async () => {
    droppedNames = [];
    mockIndexes = [
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false, hidden: false, partial: false, collation: null },
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
      { name: "email_1", entries: [{ field: "email", value: 1 }], unique: true, sparse: false, ttl: null, isId: false, hidden: false, partial: false, collation: null },
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
