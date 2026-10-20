import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { logFrontend, exportDiagnostics, takeCrashReports, openCrashFolder } from "./diagnostics";

const inv = invoke as ReturnType<typeof vi.fn>;

describe("diagnostics api", () => {
  beforeEach(() => {
    inv.mockReset();
  });

  it("logFrontend calls log_frontend with level, message and context", async () => {
    await logFrontend("error", "boom", "stack");
    expect(inv).toHaveBeenCalledWith("log_frontend", { level: "error", message: "boom", context: "stack" });
  });

  it("logFrontend sends null context when omitted", async () => {
    await logFrontend("info", "hi");
    expect(inv).toHaveBeenCalledWith("log_frontend", { level: "info", message: "hi", context: null });
  });

  it("exportDiagnostics passes the path and the setting key names only", async () => {
    await exportDiagnostics("/tmp/d.zip", ["grid-density", "api-token"]);
    expect(inv).toHaveBeenCalledTimes(1);
    const [cmd, args] = inv.mock.calls[0];
    expect(cmd).toBe("export_diagnostics");
    expect(args.path).toBe("/tmp/d.zip");
    expect([...args.settingsKeys].sort()).toEqual(["api-token", "grid-density"]);
  });

  it("takeCrashReports and openCrashFolder call their commands", async () => {
    inv.mockResolvedValueOnce([{ file: "/x/crash.txt", createdMs: 5, summary: "panicked" }]);
    expect(await takeCrashReports()).toEqual([{ file: "/x/crash.txt", createdMs: 5, summary: "panicked" }]);
    expect(inv).toHaveBeenLastCalledWith("take_crash_reports");
    await openCrashFolder();
    expect(inv).toHaveBeenLastCalledWith("open_crash_folder");
  });
});
