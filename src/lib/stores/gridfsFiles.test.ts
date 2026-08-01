import { describe, it, expect, vi } from "vitest";

const queryPageMock = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [
  { filename: "a.txt", length: 10, uploadDate: { $date: { $numberLong: "0" } } },
]);
const countDocumentsMock = vi.fn(async (..._args: unknown[]) => 1);
vi.mock("../api/documents", () => ({
  queryPage: (...args: unknown[]) => queryPageMock(...args),
  countDocuments: (...args: unknown[]) => countDocumentsMock(...args),
}));

import { createGridfsFiles } from "./gridfsFiles.svelte";

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createGridfsFiles", () => {
  it("loads the first page against '<bucket>.files' on creation", async () => {
    const store = createGridfsFiles("s1", "db1", "fs");
    await flush();
    expect(queryPageMock).toHaveBeenCalledWith("s1", "db1", "fs.files", 0, 50, "{}", '{"uploadDate":-1}');
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].filename).toBe("a.txt");
    expect(store.totalCount).toBe(1);
    expect(store.loading).toBe(false);
  });

  it("setSearch debounces, resets to page 1, and sends a filename $regex filter", async () => {
    vi.useFakeTimers();
    const store = createGridfsFiles("s1", "db1", "fs");
    await flush();
    queryPageMock.mockClear();
    store.setSearch("cat");
    vi.advanceTimersByTime(300);
    await flush();
    expect(queryPageMock).toHaveBeenCalledWith(
      "s1", "db1", "fs.files", 0, 50, JSON.stringify({ filename: { $regex: "cat", $options: "i" } }), '{"uploadDate":-1}',
    );
    expect(store.currentPage).toBe(1);
    vi.useRealTimers();
  });

  it("goToPage clamps to [1, pageCount]", async () => {
    countDocumentsMock.mockResolvedValueOnce(500); // 500 docs / 50 per page = 10 pages
    const store = createGridfsFiles("s1", "db1", "fs");
    await flush();
    store.goToPage(999);
    await flush();
    expect(store.currentPage).toBe(10);
    store.goToPage(-5);
    await flush();
    expect(store.currentPage).toBe(1);
  });

  it("an in-flight load superseded by a newer one doesn't clobber the newer result (generation guard)", async () => {
    let resolveFirst!: (v: unknown[]) => void;
    queryPageMock.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    const store = createGridfsFiles("s1", "db1", "fs");
    await flush(); // first load now in flight
    store.setPageSize(25); // starts a second load synchronously
    await flush();
    resolveFirst([{ filename: "stale.txt" }]); // first load resolves last
    await flush();
    expect(store.rows.some((r) => r.filename === "stale.txt")).toBe(false);
  });
});
