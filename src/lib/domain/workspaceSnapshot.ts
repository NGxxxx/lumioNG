// Pure model of "which tabs were open last time": what is saved on quit and how it is brought back.
// Only locations and query/filter text are kept. No results, no passwords, no URIs: a tab names its saved
// connection by id, and ad-hoc connections (no id) are never saved.
import type { Environment } from "./environment";
import { maskUrisInText } from "./uri";

export const SNAPSHOT_VERSION = 1;

/** `collection`: a session's collection/database page. `query`: a Query tab. */
export type SnapshotKind = "collection" | "query";

/** A tab as the app has it open right now (the caller maps its stores onto this). */
export type LiveTab = {
  kind: SnapshotKind;
  /** Saved connection id; null for an ad-hoc connection. */
  connId: number | null;
  db: string | null;
  coll: string | null;
  /** Collection tab: the filter box text (not applied on restore). */
  filterText: string;
  /** Query tab: the editor text. */
  scriptText: string;
};

export type SnapshotTab = Omit<LiveTab, "connId"> & { connId: number };

export type WorkspaceSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  tabs: SnapshotTab[];
  /** Index into `tabs` of the tab in focus, or null. */
  activeTab: number | null;
};

/** The saved-connection fields a restore needs. */
export type KnownConnection = { id: number; label: string; environment: Environment };

export type PlannedConnection = { connId: number; label: string; environment: Environment };

export type RestorePlan = {
  /** Tabs that can be restored (their connection still exists). */
  tabs: SnapshotTab[];
  activeTab: number | null;
  /** Tabs dropped because their connection was deleted. */
  dropped: number;
  tabCount: number;
  /** DEV / STAGING connections: reconnected without asking. */
  auto: PlannedConnection[];
  /** PROD (and unlabeled, which may well be prod) connections: only after one explicit confirmation. */
  confirm: PlannedConnection[];
};

/** Builds the snapshot of the open tabs; `activeIndex` indexes `tabs` before ad-hoc ones are removed. */
export function snapshot(tabs: LiveTab[], activeIndex: number | null = null): WorkspaceSnapshot {
  const kept: SnapshotTab[] = [];
  let activeTab: number | null = null;
  tabs.forEach((t, i) => {
    if (t.connId == null) return;
    if (i === activeIndex) activeTab = kept.length;
    kept.push({ kind: t.kind, connId: t.connId, db: t.db, coll: t.coll, filterText: maskUrisInText(t.filterText), scriptText: maskUrisInText(t.scriptText) });
  });
  return { version: SNAPSHOT_VERSION, tabs: kept, activeTab };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Reads the stored JSON back; anything unreadable or from another version yields null, bad tabs are skipped. */
export function parseSnapshot(raw: string | null): WorkspaceSnapshot | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = v as { version?: unknown; tabs?: unknown; activeTab?: unknown } | null;
  if (!o || o.version !== SNAPSHOT_VERSION || !Array.isArray(o.tabs)) return null;
  const tabs: SnapshotTab[] = [];
  let activeTab: number | null = null;
  o.tabs.forEach((t: Record<string, unknown>, i) => {
    if (!t || (t.kind !== "collection" && t.kind !== "query") || typeof t.connId !== "number") return;
    if (i === o.activeTab) activeTab = tabs.length;
    tabs.push({ kind: t.kind, connId: t.connId, db: strOrNull(t.db), coll: strOrNull(t.coll), filterText: str(t.filterText), scriptText: str(t.scriptText) });
  });
  return { version: SNAPSHOT_VERSION, tabs, activeTab };
}

/** What to restore: tabs of deleted connections drop out; the connections split into auto-connect and ask-first. */
export function restorePlan(snap: WorkspaceSnapshot, saved: KnownConnection[]): RestorePlan {
  const byId = new Map(saved.map((c) => [c.id, c]));
  const tabs: SnapshotTab[] = [];
  let activeTab: number | null = null;
  const auto = new Map<number, PlannedConnection>();
  const confirm = new Map<number, PlannedConnection>();
  snap.tabs.forEach((t, i) => {
    const c = byId.get(t.connId);
    if (!c) return;
    if (i === snap.activeTab) activeTab = tabs.length;
    tabs.push(t);
    const planned = { connId: c.id, label: c.label, environment: c.environment };
    (c.environment === "dev" || c.environment === "staging" ? auto : confirm).set(c.id, planned);
  });
  return { tabs, activeTab, dropped: snap.tabs.length - tabs.length, tabCount: tabs.length, auto: [...auto.values()], confirm: [...confirm.values()] };
}
