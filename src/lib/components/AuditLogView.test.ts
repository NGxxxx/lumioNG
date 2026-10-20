import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/svelte";

const entry = {
  ts: 1_790_000_000_000, os_user: "ann", app_version: "0.6.0", session_label: "Orders", environment: "prod",
  op: "update_many", ns: "shop.orders", filter_redacted: { email: "<str:15>" }, count: 3, ok: true, error: null,
  source: "ui", prev_hash: "0",
};
vi.mock("../api/audit", () => ({
  auditSetScope: vi.fn(async () => {}),
  auditQuery: vi.fn(async () => [entry, { ...entry, session_label: "Other", op: "delete_many", ok: false, error: "boom" }]),
  auditVerify: vi.fn(async () => ({ ok: false, files: 1, lines: 4, brokenFile: "audit-2026-10.jsonl", brokenLine: 3, torn: [{ file: "audit-2026-10.jsonl", line: 9 }] })),
  auditExport: vi.fn(async () => 2),
}));
vi.mock("../stores/desktop", () => ({ pickSavePath: vi.fn(async () => null) }));

import AuditLogView from "./AuditLogView.svelte";
import { auditSetScope, auditVerify } from "../api/audit";
import { prefs } from "../stores/prefs.svelte";

beforeEach(() => {
  prefs.clear();
  vi.clearAllMocks();
});

describe("AuditLogView", () => {
  it("lists entries and filters by connection", async () => {
    render(AuditLogView, { onclose: () => {} });
    await waitFor(() => expect(screen.getByText("update_many")).toBeTruthy());
    expect(screen.getByText("delete_many")).toBeTruthy();
    await fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "Orders" } });
    expect(screen.queryByText("delete_many")).toBeNull();
    expect(screen.getByText("update_many")).toBeTruthy();
  });

  it("changing the audited environments pushes the scope to Rust", async () => {
    render(AuditLogView, { onclose: () => {} });
    await fireEvent.change(screen.getByLabelText("Audited environments"), { target: { value: "all" } });
    expect(auditSetScope).toHaveBeenLastCalledWith("all");
    expect(prefs.getItem("audit-scope")).toBe("all");
  });

  it("reports a broken chain with its file and line", async () => {
    render(AuditLogView, { onclose: () => {} });
    await fireEvent.click(screen.getByText("Check integrity"));
    await waitFor(() => expect(auditVerify).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByRole("status")[0].textContent).toContain("audit-2026-10.jsonl"));
    expect(screen.getAllByRole("status")[0].textContent).toContain("3");
    expect(screen.getByText(/half-written/)).toBeTruthy();
  });
});
