import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

// The row virtualizer needs a nonzero scroller height to produce virtual items in jsdom
// (see ResultGrid.test.ts for the same pattern).
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

const storeStub = {
  rows: [
    { doc: { filename: "a.png" }, filename: "a.png", length: 1024, contentType: "image/png", uploadDateIso: "2024-01-01T00:00:00.000Z" },
  ],
  search: "",
  currentPage: 1,
  pageCount: 1,
  pageSize: 50,
  totalCount: 1,
  loading: false,
  error: null,
  setSearch: vi.fn(),
  goToPage: vi.fn(),
  nextPage: vi.fn(),
  prevPage: vi.fn(),
  setPageSize: vi.fn(),
  refresh: vi.fn(),
};
vi.mock("../stores/gridfsFilesCache.svelte", () => ({ getGridfsFiles: () => storeStub }));
vi.mock("../stores/sessionManager.svelte", () => ({ sessionManager: { active: { id: "s1" } } }));

import GridFsFilesPanel from "./GridFsFilesPanel.svelte";

describe("GridFsFilesPanel", () => {
  it("renders the file list with filename, formatted size, and content type", () => {
    render(GridFsFilesPanel, { db: "db1", bucket: "fs", version: 0 });
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("image/png")).toBeInTheDocument();
  });

  it("typing in the search box calls store.setSearch", async () => {
    render(GridFsFilesPanel, { db: "db1", bucket: "fs", version: 0 });
    const input = screen.getByPlaceholderText("Search filename…");
    await fireEvent.input(input, { target: { value: "cat" } });
    expect(storeStub.setSearch).toHaveBeenCalledWith("cat");
  });

  it("clicking Preview on a row opens the preview panel", async () => {
    render(GridFsFilesPanel, { db: "db1", bucket: "fs", version: 0 });
    await fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("Download")).toBeInTheDocument(); // preview panel's own Download button
  });
});
