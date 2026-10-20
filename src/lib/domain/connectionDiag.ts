// Presentation of the connection diagnosis steps returned by Rust (`diagnose_connection`).
import { classifyError, type FriendlyError } from "./connectionError";

/** One link of the connection chain, in the order Rust checks them. */
export interface DiagStep {
  step: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface DescribedStep {
  /** Message key of the step's name (`diag_step_<step>`). */
  labelKey: string;
  /** Localizable explanation of a failed step, when the error is a known one. */
  friendly: FriendlyError | null;
  /** The (already redacted) detail text from the backend. */
  detail: string;
}

export function describeDiagStep(s: DiagStep): DescribedStep {
  let friendly: FriendlyError | null = null;
  if (!s.ok) {
    friendly = classifyError(s.detail);
    if (!friendly && /timed out/i.test(s.detail)) friendly = { key: "err_conn_unreachable" };
  }
  return { labelKey: `diag_step_${s.step}`, friendly, detail: s.detail };
}

/** The step the diagnosis stopped at, or null when every step passed. */
export function diagnosisVerdict(steps: DiagStep[]): DiagStep | null {
  return steps.find((s) => !s.ok) ?? null;
}
