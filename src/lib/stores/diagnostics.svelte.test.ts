import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/diagnostics", () => ({
  logFrontend: vi.fn().mockResolvedValue(undefined),
  takeCrashReports: vi.fn(),
  openCrashFolder: vi.fn(),
  exportDiagnostics: vi.fn(),
}));
vi.mock("../api/files", () => ({ readTextFileIfExists: vi.fn() }));

import { logFrontend, takeCrashReports, exportDiagnostics } from "../api/diagnostics";
import { installErrorLogging, createCrashReports, saveDiagnostics } from "./diagnostics.svelte";

const log = logFrontend as ReturnType<typeof vi.fn>;

describe("installErrorLogging", () => {
  beforeEach(() => log.mockClear());

  it("forwards window errors and unhandled rejections, and stops after uninstall", () => {
    const uninstall = installErrorLogging(window);
    window.dispatchEvent(new ErrorEvent("error", { message: "kaput", filename: "a.js", lineno: 3, colno: 4 }));
    expect(log).toHaveBeenCalledWith("error", "kaput", "a.js:3:4");

    const ev = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(ev, "reason", { value: new Error("nope") });
    window.dispatchEvent(ev);
    expect(log.mock.calls[1][1]).toContain("nope");

    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { message: "later" }));
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe("createCrashReports", () => {
  it("loads reports and clears them on dismiss; a failing API leaves it empty", async () => {
    (takeCrashReports as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ file: "f", createdMs: 1, summary: "s" }]);
    const c = createCrashReports();
    await c.load();
    expect(c.reports).toHaveLength(1);
    c.dismiss();
    expect(c.reports).toEqual([]);
    (takeCrashReports as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("x"));
    await c.load();
    expect(c.reports).toEqual([]);
  });
});

describe("saveDiagnostics", () => {
  it("returns null on success and the error text on failure", async () => {
    const exp = exportDiagnostics as ReturnType<typeof vi.fn>;
    exp.mockResolvedValueOnce(undefined);
    expect(await saveDiagnostics("/p.zip")).toBeNull();
    exp.mockRejectedValueOnce({ kind: "Io", message: "disk full" });
    expect(await saveDiagnostics("/p.zip")).toContain("disk full");
  });
});
