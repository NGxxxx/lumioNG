import { describe, expect, it } from "vitest";
import { healthSummary } from "./serverHealth";
import type { OpKind, Rates, Sample, SlowOp } from "./serverMetrics";

const OPS0: Record<OpKind, number> = { insert: 0, query: 0, update: 0, delete: 0, getmore: 0, command: 0 };

const sample = (connCurrent: number, connAvailable: number): Sample => ({
  at: 0, uptime: 10, opcounters: { ...OPS0 }, connCurrent, connAvailable,
  netIn: 0, netOut: 0, memResidentMb: null, host: null, version: null,
});
const rates: Rates = { ops: 1240.4, byKind: { ...OPS0, query: 1240.4 }, netInPerSec: 0, netOutPerSec: 0 };
const op = (secs: number): SlowOp => ({ opid: secs, op: "query", ns: "a.b", secs, client: "", appName: "" });

const base = { rates, sample: sample(38, 800), slowOps: [] as SlowOp[], thresholdSecs: 1, permitted: true, stale: false, retryInSecs: 0 };

describe("healthSummary", () => {
  it("stale → health_lost with secs (beats everything)", () => {
    expect(healthSummary({ ...base, stale: true, permitted: false, slowOps: [op(9)], retryInSecs: 4 }))
      .toEqual({ tone: "error", key: "health_lost", params: { secs: "4" } });
  });

  it("not permitted beats slow ops", () => {
    expect(healthSummary({ ...base, permitted: false, slowOps: [op(9)] }))
      .toEqual({ tone: "warn", key: "health_not_permitted", params: {} });
  });

  it("slow ops count at threshold", () => {
    expect(healthSummary({ ...base, slowOps: [op(30), op(6), op(5)], thresholdSecs: 5, sample: sample(85, 15) }))
      .toEqual({ tone: "warn", key: "health_slow_ops", params: { count: "3", secs: "5" } });
  });

  it("slow ops below the current threshold are not counted", () => {
    expect(healthSummary({ ...base, slowOps: [op(2)], thresholdSecs: 5 }).key).toBe("health_stable");
  });

  it("connections ≥ 80% → health_conn_high", () => {
    expect(healthSummary({ ...base, sample: sample(85, 15) }))
      .toEqual({ tone: "warn", key: "health_conn_high", params: { pct: "85" } });
    expect(healthSummary({ ...base, sample: sample(79, 21) }).key).toBe("health_stable");
  });

  it("otherwise health_stable with ops and conns", () => {
    expect(healthSummary(base)).toEqual({ tone: "ok", key: "health_stable", params: { ops: "1240", conns: "38" } });
  });

  it("stable without rates/sample yet uses a dash", () => {
    expect(healthSummary({ ...base, rates: null, sample: null }))
      .toEqual({ tone: "ok", key: "health_stable", params: { ops: "—", conns: "—" } });
  });
});
