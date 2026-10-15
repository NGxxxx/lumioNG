/** One-line health verdict for the Overview strip: returns a message key + string params only (no text). */
import type { Rates, Sample, SlowOp } from "./serverMetrics";

export type Health = { tone: "ok" | "warn" | "error"; key: string; params: Record<string, string> };

const CONN_HIGH_PCT = 80;

/** Priority: lost > not permitted > slow ops > connections ≥ 80 % > stable. */
export function healthSummary(input: {
  rates: Rates | null;
  sample: Sample | null;
  slowOps: SlowOp[];
  thresholdSecs: number;
  permitted: boolean;
  stale: boolean;
  retryInSecs: number;
}): Health {
  const { rates, sample, slowOps, thresholdSecs, permitted, stale, retryInSecs } = input;
  if (stale) return { tone: "error", key: "health_lost", params: { secs: String(retryInSecs) } };
  if (!permitted) return { tone: "warn", key: "health_not_permitted", params: {} };
  const slow = slowOps.filter((o) => o.secs >= thresholdSecs).length;
  if (slow > 0) return { tone: "warn", key: "health_slow_ops", params: { count: String(slow), secs: String(thresholdSecs) } };
  if (sample) {
    const total = sample.connCurrent + sample.connAvailable;
    const pct = total > 0 ? Math.round((sample.connCurrent / total) * 100) : 0;
    if (pct >= CONN_HIGH_PCT) return { tone: "warn", key: "health_conn_high", params: { pct: String(pct) } };
  }
  return {
    tone: "ok",
    key: "health_stable",
    params: {
      ops: rates ? String(Math.round(rates.ops)) : "—",
      conns: sample ? String(sample.connCurrent) : "—",
    },
  };
}
