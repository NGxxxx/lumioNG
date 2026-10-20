/** Pure helpers for the audit log screen and its settings (the log itself is written by Rust). */

/** Which environments are audited; mirrors the Rust `AuditScope`. PROD only by default. */
export type AuditScope = "prod" | "staging_prod" | "all";
export const AUDIT_SCOPES: readonly AuditScope[] = ["prod", "staging_prod", "all"];
export const DEFAULT_AUDIT_SCOPE: AuditScope = "prod";

export type AuditSource = "ui" | "script" | "mcp" | "import" | "sync";

export type AuditEntry = {
  ts: number;
  os_user: string;
  app_version: string;
  session_label: string;
  environment: string;
  op: string;
  ns: string;
  filter_redacted: unknown;
  count: number | null;
  ok: boolean;
  error: string | null;
  source: AuditSource | string;
  prev_hash: string;
};

export type VerifyReport = {
  ok: boolean;
  files: number;
  lines: number;
  brokenFile: string | null;
  brokenLine: number | null;
  /** Half-written lines left by a crash: skipped by the chain, not tampering. */
  torn: { file: string; line: number }[];
};

export function parseAuditScope(raw: string | null | undefined): AuditScope {
  return (AUDIT_SCOPES as readonly string[]).includes(raw ?? "") ? (raw as AuditScope) : DEFAULT_AUDIT_SCOPE;
}

export type AuditRange = "24h" | "7d" | "30d" | "all";
export const AUDIT_RANGES: readonly AuditRange[] = ["24h", "7d", "30d", "all"];
const DAY_MS = 86_400_000;

/** `[from, to]` epoch-millis bounds for a range ending at `now`. */
export function rangeBounds(range: AuditRange, now: number): [number, number] {
  switch (range) {
    case "24h": return [now - DAY_MS, now];
    case "7d": return [now - 7 * DAY_MS, now];
    case "30d": return [now - 30 * DAY_MS, now];
    case "all": return [0, now];
  }
}

/** Distinct connection labels in the entries, sorted. */
export function connectionLabels(entries: readonly AuditEntry[]): string[] {
  return [...new Set(entries.map((e) => e.session_label).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Entries of one connection label ("" = all). */
export function filterByConnection(entries: readonly AuditEntry[], label: string): AuditEntry[] {
  return label ? entries.filter((e) => e.session_label === label) : [...entries];
}

/** Compact one-line text of a redacted filter for the table. */
export function filterText(f: unknown): string {
  if (f === null || f === undefined) return "";
  try {
    return JSON.stringify(f);
  } catch {
    return "";
  }
}
