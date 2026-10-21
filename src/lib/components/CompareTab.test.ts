import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("../api/compare", () => ({
  compareStart: vi.fn(),
  comparePage: vi.fn(),
  compareDispose: vi.fn(async () => {}),
  compareCancel: vi.fn(async () => {}),
  syncApply: vi.fn(),
}));
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: {
    sessions: [
      { id: "a", label: "Local", environment: "dev", readOnly: false, tree: { databases: [{ name: "shop", collections: ["orders"] }] } },
      { id: "b", label: "Live", environment: "prod", readOnly: false, tree: { databases: [] } },
    ],
  },
}));

import { compareStart, comparePage, syncApply } from "../api/compare";
import CompareTab from "./CompareTab.svelte";

const summary = { onlySrc: 1, onlyDst: 0, different: 1, same: 5, truncated: false };

beforeEach(() => {
  vi.mocked(compareStart).mockReset().mockResolvedValue(summary);
  vi.mocked(comparePage).mockReset().mockResolvedValue({
    total: 1, rows: [{ kind: "different", key: { $numberInt: "4" }, src: { _id: 4, a: 1 }, dst: { _id: 4, a: 2 } }],
  });
  vi.mocked(syncApply).mockReset().mockImplementation(async (_id, _p, dryRun) => ({
    dryRun, planned: { insert: 1, replace: 1, delete: 0 }, applied: { insert: 0, replace: 0, delete: 0 }, failed: 0, errors: [], summary, cancelled: false, skipped: 0, typeConflicts: 1,
  }));
});

async function setDst(container: HTMLElement) {
  const selects = container.querySelectorAll("select");
  await fireEvent.change(selects[1], { target: { value: "b" } });
  const db = container.querySelector('input[aria-label="Destination Database"]')!;
  const coll = container.querySelector('input[aria-label="Destination Collection"]')!;
  await fireEvent.input(db, { target: { value: "shop" } });
  await fireEvent.input(coll, { target: { value: "orders" } });
}

describe("CompareTab", () => {
  it("shows the direction with the written side's environment and needs a dry run before sync", async () => {
    const c = render(CompareTab, { tab: { id: 1, kind: "compare", sessionId: "a", db: "shop", coll: "orders" } });
    await setDst(c.container);
    const dir = c.container.querySelector(".direction")!;
    expect(dir.textContent).toContain("Local");
    expect(dir.textContent).toContain("→");
    expect(dir.textContent).toContain("Live");
    expect(dir.textContent).toContain("PROD");
    expect(dir.classList.contains("prod")).toBe(true);
    expect(c.getByText(/type the collection name/)).toBeTruthy();
    const apply = c.getByRole("button", { name: "Apply sync" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await fireEvent.click(c.getByRole("button", { name: "Dry run" }));
    await vi.waitFor(() => expect(c.getByText(/would insert 1, replace 1, delete 0/)).toBeTruthy());
    expect(c.getByText(/1 pair\(s\) with _id values of different types/)).toBeTruthy();
    expect(apply.disabled).toBe(false);
    await fireEvent.click(apply);
    await vi.waitFor(() => expect(c.getByRole("dialog")).toBeTruthy());
    expect(syncApply).toHaveBeenCalledTimes(1);
  });

  it("explains that ignored paths do not reach inside arrays", () => {
    const c = render(CompareTab, { tab: { id: 3, kind: "compare", sessionId: "a", db: "shop", coll: "orders" } });
    expect(c.getByText(/not inside arrays/)).toBeTruthy();
  });

  it("lists differences with the field diff", async () => {
    const c = render(CompareTab, { tab: { id: 2, kind: "compare", sessionId: "a", db: "shop", coll: "orders" } });
    await setDst(c.container);
    await fireEvent.click(c.getByRole("button", { name: "Compare" }));
    await vi.waitFor(() => expect(c.getByText("4")).toBeTruthy());
    await tick();
    expect(c.container.querySelector(".changes")?.textContent).toContain("a: 2 → 1");
  });
});
