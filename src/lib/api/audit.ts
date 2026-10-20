import { invoke } from "@tauri-apps/api/core";
import type { AuditEntry, AuditScope, VerifyReport } from "../domain/audit";

/** Tells Rust which environments to audit (it audits PROD only until told otherwise). */
export async function auditSetScope(scope: AuditScope): Promise<void> {
  await invoke("audit_set_scope", { scope });
}

/** Entries with `fromMs <= ts <= toMs`, newest first, optionally of one environment. */
export async function auditQuery(fromMs: number, toMs: number, environment: string | null = null): Promise<AuditEntry[]> {
  return await invoke<AuditEntry[]>("audit_query", { fromMs, toMs, environment });
}

/** Re-computes the hash chain of every audit file. */
export async function auditVerify(): Promise<VerifyReport> {
  return await invoke<VerifyReport>("audit_verify");
}

/** Copies the whole log (JSONL, chain intact) to `path`; resolves to the number of lines. */
export async function auditExport(path: string): Promise<number> {
  return await invoke<number>("audit_export", { path });
}
