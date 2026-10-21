// src/lib/api/compare.ts — compare two collections and sync one into the other (commands::compare).
import { invoke, Channel } from "@tauri-apps/api/core";
import type { Doc } from "../domain/doc";
import type { NsRef, SyncPlan, DiffKind, DiffSummary, SyncReport } from "../domain/compare";

export type CompareProgress = { read: number; total: number | null; written: number };
export type DiffRow = { kind: DiffKind; key: unknown; src: Doc | null; dst: Doc | null };
export type DiffPage = { rows: DiffRow[]; total: number };

type RawRow = { kind: DiffKind; key: string; src: string | null; dst: string | null };

/** Streams both collections sorted by `key` and compares them; keys of the first 100,000 differences stay in Rust for `comparePage`. */
export async function compareStart(
  compareId: string,
  src: NsRef,
  dst: NsRef,
  key: string,
  filter: string | null,
  ignoreFields: string[],
  onProgress: (p: CompareProgress) => void,
): Promise<DiffSummary> {
  const ch = new Channel<CompareProgress>();
  ch.onmessage = onProgress;
  return await invoke<DiffSummary>("compare_start", { compareId, src, dst, key, filter, ignoreFields, onProgress: ch });
}

/** One page of stored differences of `kind`, with the documents as they are now on each side. */
export async function comparePage(compareId: string, kind: Exclude<DiffKind, "same">, skip: number, limit: number): Promise<DiffPage> {
  const res = await invoke<{ rows: RawRow[]; total: number }>("compare_page", { compareId, kind, skip, limit });
  return {
    total: res.total,
    rows: res.rows.map((r) => ({
      kind: r.kind,
      key: JSON.parse(r.key) as unknown,
      src: r.src === null ? null : (JSON.parse(r.src) as Doc),
      dst: r.dst === null ? null : (JSON.parse(r.dst) as Doc),
    })),
  };
}

export async function compareDispose(compareId: string): Promise<void> {
  await invoke("compare_dispose", { compareId });
}

/** Stops this compare tab's running compare or sync (its own flag; exports/imports are not touched). */
export async function compareCancel(compareId: string): Promise<void> {
  await invoke("compare_cancel", { compareId });
}

/** Dry run (`dryRun`) or real sync. Rust refuses a real sync without a matching dry run in the last
 *  10 minutes, into a read-only connection, or into PROD unless `confirmed`, and stops it if it would
 *  write more of any operation than the dry run announced. */
export async function syncApply(
  compareId: string,
  plan: SyncPlan,
  dryRun: boolean,
  confirmed: boolean,
  onProgress: (p: CompareProgress) => void,
): Promise<SyncReport> {
  const ch = new Channel<CompareProgress>();
  ch.onmessage = onProgress;
  return await invoke<SyncReport>("sync_apply", { compareId, plan, dryRun, confirmed, onProgress: ch });
}
