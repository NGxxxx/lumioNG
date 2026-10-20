import { describe, it, expect, vi } from "vitest";

const order: string[] = [];
vi.mock("../api/window", () => ({
  quit: vi.fn(async () => { order.push("quit"); }),
  minimize: vi.fn(), toggleMaximize: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(),
}));
vi.mock("../api/files", () => ({ openDialog: vi.fn(), saveDialog: vi.fn(), openDirDialog: vi.fn(), readTextFileIfExists: vi.fn(), importFileSize: vi.fn() }));
vi.mock("../api/app", () => ({ getAppVersion: vi.fn(), getAppInfo: vi.fn() }));
vi.mock("../api/connection", () => ({ forgetSshHostKey: vi.fn() }));
vi.mock("./prefs.svelte", () => ({
  prefs: { flush: vi.fn(async () => { await Promise.resolve(); order.push("flush"); }) },
}));

import { windowControls } from "./desktop";

describe("windowControls.quit", () => {
  it("awaits prefs.flush before closing the window", async () => {
    await windowControls.quit();
    expect(order).toEqual(["flush", "quit"]);
  });
});
