import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

const previewMock = vi.fn(async (..._args: unknown[]): Promise<string> => btoa("hello"));
vi.mock("../api/gridfs", () => ({ gridfsPreviewBytes: (...args: unknown[]) => previewMock(...args) }));
vi.mock("../stores/sessionManager.svelte", () => ({ sessionManager: { active: { id: "s1" } } }));
vi.mock("../stores/gridfsDownload.svelte", () => ({
  createGridfsDownload: () => ({ status: "idle", done: 0, total: 0, error: null, start: vi.fn(), cancel: vi.fn() }),
}));

import GridFsPreviewPanel from "./GridFsPreviewPanel.svelte";

const baseRow = { doc: { filename: "notes.txt" }, filename: "notes.txt", length: 5, contentType: "text/plain", uploadDateIso: null };

describe("GridFsPreviewPanel", () => {
  beforeEach(() => {
    previewMock.mockClear();
  });

  it("fetches and renders a text preview when under the cap", async () => {
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row: baseRow, onclose: vi.fn() });
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("s1", "db1", "fs", baseRow.doc));
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
  });

  it("shows the cap message and skips the network call when the file is over the cap", async () => {
    const bigRow = { ...baseRow, length: 10 * 1024 * 1024 };
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row: bigRow, onclose: vi.fn() });
    expect(screen.getByText("File exceeds the 5MB preview limit — download it to view.")).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("shows an error message when the preview call fails", async () => {
    previewMock.mockRejectedValueOnce(new Error("boom"));
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row: baseRow, onclose: vi.fn() });
    await waitFor(() => expect(screen.getByText("Preview failed: boom")).toBeInTheDocument());
  });

  it("shows the unsupported message and skips the network call for an unknown-kind file", async () => {
    const unknownRow = { ...baseRow, filename: "archive.zip", contentType: undefined };
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row: unknownRow, onclose: vi.fn() });
    expect(screen.getByText("This file type can't be previewed.")).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });
});
