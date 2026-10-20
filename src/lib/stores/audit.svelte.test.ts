import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/audit", () => ({
  auditSetScope: vi.fn(async () => {}),
  auditQuery: vi.fn(async () => []),
  auditVerify: vi.fn(async () => ({ ok: true, files: 1, lines: 3, brokenFile: null, brokenLine: null, torn: [] })),
  auditExport: vi.fn(async () => 3),
}));

import { createAudit } from "./audit.svelte";
import { auditSetScope, auditQuery, auditVerify } from "../api/audit";
import { prefs } from "./prefs.svelte";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  prefs.clear();
  vi.clearAllMocks();
});

describe("audit store", () => {
  it("audits PROD only by default and pushes the scope to Rust on init", async () => {
    const a = createAudit();
    expect(a.scope).toBe("prod");
    a.init();
    await flush();
    expect(auditSetScope).toHaveBeenCalledWith("prod");
  });

  it("persists a changed scope under audit-scope and pushes it", async () => {
    const a = createAudit();
    a.setScope("staging_prod");
    await flush();
    expect(prefs.getItem("audit-scope")).toBe("staging_prod");
    expect(auditSetScope).toHaveBeenLastCalledWith("staging_prod");
    expect(createAudit().scope).toBe("staging_prod");
  });

  it("ignores a junk stored scope", () => {
    prefs.setItem("audit-scope", "nope");
    expect(createAudit().scope).toBe("prod");
  });

  it("loads entries for a range and environment, and verifies the chain", async () => {
    const a = createAudit();
    await a.load("7d", "prod");
    expect(auditQuery).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), "prod");
    expect(a.error).toBeNull();
    await a.verify();
    expect(auditVerify).toHaveBeenCalled();
    expect(a.report?.ok).toBe(true);
  });

  it("reports a load failure", async () => {
    (auditQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ kind: "Io", message: "disk" });
    const a = createAudit();
    await a.load("all", "");
    expect(a.error).toBeTruthy();
    expect(a.loading).toBe(false);
  });
});
