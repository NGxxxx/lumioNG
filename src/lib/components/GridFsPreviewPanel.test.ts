import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

const previewMock = vi.fn(async (..._args: unknown[]): Promise<string> => btoa("hello"));
const downloadMock = vi.fn();
vi.mock("../api/gridfs", () => ({
  gridfsPreviewBytes: (...args: unknown[]) => previewMock(...args),
  gridfsDownload: (...args: unknown[]) => downloadMock(...args),
}));
vi.mock("../stores/sessionManager.svelte", () => ({ sessionManager: { active: { id: "s1" } } }));
const saveDialogMock = vi.fn();
vi.mock("../api/files", () => ({ saveDialog: (...args: unknown[]) => saveDialogMock(...args) }));
vi.mock("../api/documents", () => ({ cancelExportProgress: vi.fn() }));

import GridFsPreviewPanel from "./GridFsPreviewPanel.svelte";

const baseRow = { doc: { filename: "notes.txt" }, filename: "notes.txt", length: 5, contentType: "text/plain", uploadDateIso: null };

describe("GridFsPreviewPanel", () => {
  beforeEach(() => {
    previewMock.mockClear();
    downloadMock.mockReset();
    saveDialogMock.mockReset();
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

  it("resets stale loading/base64/error state when the row prop changes", async () => {
    const imageRow = { ...baseRow, filename: "a.png", contentType: "image/png" };
    previewMock.mockResolvedValueOnce(btoa("pngbytes"));
    const { rerender } = render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row: imageRow, onclose: vi.fn() });
    await waitFor(() => expect(screen.getByAltText("a.png")).toBeInTheDocument());

    // Switch to an "unknown"-kind row -- if loading/base64/error weren't reset, the previous <img>
    // (or a stale error) could linger instead of the "not previewable" message.
    previewMock.mockClear();
    const unknownRow = { ...baseRow, filename: "b.xyz", contentType: undefined };
    await rerender({ db: "db1", bucket: "fs", row: unknownRow, onclose: vi.fn() });

    expect(screen.queryByAltText("a.png")).not.toBeInTheDocument();
    expect(screen.getByText("This file type can't be previewed.")).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("shows an indeterminate progress message instead of a bogus 'X / 0' fraction when total bytes is unknown", async () => {
    saveDialogMock.mockResolvedValueOnce("/tmp/out.png");
    let sendProgress: ((done: number, total: number) => void) | undefined;
    downloadMock.mockImplementation(
      (
        _s: string,
        _db: string,
        _bucket: string,
        _doc: unknown,
        _total: number,
        _path: string,
        onProgress: (d: number, t: number) => void,
      ) =>
        new Promise<void>(() => {
          sendProgress = onProgress; // never resolves in this test -- only the mid-flight display matters
        }),
    );
    const row = { ...baseRow, filename: "a.png", contentType: "image/png", length: null };
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row, onclose: vi.fn() });

    await fireEvent.click(screen.getByText("Download"));
    await waitFor(() => expect(sendProgress).toBeDefined());
    sendProgress?.(2048, 0);

    await waitFor(() => expect(screen.getByText("2048 bytes downloaded…")).toBeInTheDocument());
    expect(screen.queryByText("2048 / 0")).not.toBeInTheDocument();
  });

  it("renders a fallback download link alongside the PDF embed", async () => {
    const b64 = btoa("pdfbytes");
    previewMock.mockResolvedValueOnce(b64);
    const row = { ...baseRow, filename: "report.pdf", contentType: "application/pdf" };
    render(GridFsPreviewPanel, { db: "db1", bucket: "fs", row, onclose: vi.fn() });

    await waitFor(() => expect(document.querySelector("embed[type='application/pdf']")).toBeInTheDocument());
    const link = screen.getByText("PDF not displaying? Open/download it directly");
    expect(link.closest("a")).toHaveAttribute("href", `data:application/pdf;base64,${b64}`);
  });
});
