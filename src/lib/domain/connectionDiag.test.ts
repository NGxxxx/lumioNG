import { describe, it, expect } from "vitest";
import { describeDiagStep, diagnosisVerdict, type DiagStep } from "./connectionDiag";

const step = (s: Partial<DiagStep>): DiagStep => ({ step: "dns", ok: true, ms: 3, detail: "", ...s });

describe("describeDiagStep", () => {
  it("labels each step with its own message key", () => {
    expect(describeDiagStep(step({ step: "tcp" })).labelKey).toBe("diag_step_tcp");
    expect(describeDiagStep(step({ step: "hello" })).labelKey).toBe("diag_step_hello");
  });

  it("explains a failed step through classifyError", () => {
    const d = describeDiagStep(step({ step: "dns", ok: false, detail: "db.invalid: failed to lookup address information" }));
    expect(d.friendly).toEqual({ key: "err_conn_dns" });
  });

  it("explains a TCP timeout as unreachable", () => {
    const d = describeDiagStep(step({ step: "tcp", ok: false, detail: "db:27017: connection timed out after 5 s" }));
    expect(d.friendly).toEqual({ key: "err_conn_unreachable" });
  });

  it("keeps the raw detail and gives no friendly text for an unrecognised failure", () => {
    const d = describeDiagStep(step({ ok: false, detail: "weird" }));
    expect(d.friendly).toBeNull();
    expect(d.detail).toBe("weird");
  });

  it("never explains a passing step", () => {
    expect(describeDiagStep(step({ detail: "connection refused" })).friendly).toBeNull();
  });
});

describe("diagnosisVerdict", () => {
  it("is the first failed step, or null when all pass", () => {
    expect(diagnosisVerdict([step({}), step({ step: "tcp", ok: false })])?.step).toBe("tcp");
    expect(diagnosisVerdict([step({})])).toBeNull();
    expect(diagnosisVerdict([])).toBeNull();
  });
});
