import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

const copied: string[] = [];
vi.mock("#lib/api/diagnostics.js", () => ({
  takeCrashReports: vi.fn(),
  openCrashFolder: vi.fn().mockResolvedValue(undefined),
  logFrontend: vi.fn(),
  exportDiagnostics: vi.fn(),
}));
vi.mock("#lib/api/files.js", () => ({ readTextFileIfExists: vi.fn().mockResolvedValue("FULL REPORT TEXT") }));
vi.mock("#lib/stores/clipboardCopy.js", () => ({ createClipboardCopy: () => async (t: string) => void copied.push(t) }));

import CrashReportDialog from "./CrashReportDialog.svelte";
import { takeCrashReports, openCrashFolder } from "#lib/api/diagnostics.js";

const take = takeCrashReports as ReturnType<typeof vi.fn>;

describe("CrashReportDialog", () => {
  beforeEach(() => {
    take.mockReset();
    copied.length = 0;
  });

  it("shows nothing when there are no crash reports", async () => {
    take.mockResolvedValue([]);
    const { queryByRole } = render(CrashReportDialog);
    await waitFor(() => expect(take).toHaveBeenCalled());
    expect(queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("shows the dialog when the API returns one report, and copies / opens / dismisses", async () => {
    take.mockResolvedValue([{ file: "/logs/crash/seen/crash-1.txt", createdMs: 1_700_000_000_000, summary: "panicked at x.rs:1:1: boom" }]);
    const { findByText, getByRole, queryByRole } = render(CrashReportDialog);
    expect(await findByText("panicked at x.rs:1:1: boom")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(copied).toEqual(["FULL REPORT TEXT"]));

    await fireEvent.click(getByRole("button", { name: "Open folder" }));
    expect(openCrashFolder).toHaveBeenCalled();

    await fireEvent.click(getByRole("button", { name: "Dismiss" }));
    expect(queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
