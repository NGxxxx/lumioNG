import { prefs } from "./prefs.svelte";
import {
  snapshot,
  parseSnapshot,
  restorePlan,
  type KnownConnection,
  type LiveTab,
  type PlannedConnection,
  type RestorePlan,
  type SnapshotTab,
} from "../domain/workspaceSnapshot";

export const SNAPSHOT_KEY = "workspace-snapshot";
const SAVE_DELAY_MS = 1500;

/** What the restore needs from the rest of the app (wired in appContext; faked in tests). */
export type RestoreDeps = {
  /** The tabs open right now; `active` indexes `tabs`. */
  capture(): { tabs: LiveTab[]; active: number | null };
  listSaved(): Promise<KnownConnection[]>;
  /** Opens the saved connection through the normal connect path (a locked vault asks for its password). */
  connect(connId: number): Promise<boolean | "cancelled">;
  /** Opens one tab on its already-connected session. Must not run anything. */
  openTab(tab: SnapshotTab): void;
  /** Brings that tab to the front. */
  activate(tab: SnapshotTab): void;
  onConnectFailed(label: string): void;
  /** The vault unlock was cancelled during this restore (called once, at the end). */
  onUnlockCancelled(): void;
};

export type RestorePrompt = { stage: "restore" | "prod"; plan: RestorePlan };

/**
 * Remembers the open tabs in prefs and offers to bring them back on the next start.
 * Nothing is written until the offer is settled, so an unanswered or declined offer cannot overwrite
 * the old snapshot with an empty one before the user chose.
 */
export function createWorkspaceRestore(deps: RestoreDeps, saveDelayMs = SAVE_DELAY_MS) {
  let prompt = $state.raw<RestorePrompt | null>(null);
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeTarget: SnapshotTab | null = null;
  const connected = new Set<number>();
  let unlockCancelled = false;

  function write(c: { tabs: LiveTab[]; active: number | null }) {
    prefs.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot(c.tabs, c.active)));
  }

  /** Writes the current tabs now (the quit path calls this just before the prefs flush). */
  function saveNow() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (ready) write(deps.capture());
  }

  /** Debounced write after the tabs changed, so a crash loses at most the last moments. */
  function queueSave() {
    if (!ready) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(saveNow, saveDelayMs);
  }

  function settle() {
    prompt = null;
    activeTarget = null;
    connected.clear();
    if (unlockCancelled) {
      unlockCancelled = false;
      deps.onUnlockCancelled();
    }
    ready = true;
    saveNow();
  }

  async function restoreConnections(plan: RestorePlan, conns: PlannedConnection[]) {
    for (const c of conns) {
      if (unlockCancelled) return; // the vault stays locked: skip the rest silently
      const r = await deps.connect(c.connId);
      if (r === "cancelled") {
        unlockCancelled = true;
      } else if (r) {
        connected.add(c.connId);
        for (const t of plan.tabs) if (t.connId === c.connId) deps.openTab(t);
      } else {
        deps.onConnectFailed(c.label);
      }
    }
  }

  function focusTarget(plan: RestorePlan) {
    const t = plan.activeTab !== null ? plan.tabs[plan.activeTab] : null;
    if (t && connected.has(t.connId)) deps.activate(t);
  }

  return {
    /** The open offer, if any (AppDialogs renders it). */
    get prompt() { return prompt; },
    /** Reads the last snapshot and offers it; settles immediately when there is nothing to restore. */
    async init(): Promise<void> {
      const snap = parseSnapshot(prefs.getItem(SNAPSHOT_KEY));
      if (!snap || snap.tabs.length === 0) return settle();
      let saved: KnownConnection[];
      try {
        saved = await deps.listSaved();
      } catch {
        return settle();
      }
      const plan = restorePlan(snap, saved);
      if (plan.tabCount === 0) return settle();
      prompt = { stage: "restore", plan };
    },
    /** "Restore": reconnect DEV/STAGING now; ask once more about the rest. */
    async accept(): Promise<void> {
      const p = prompt;
      if (!p || p.stage !== "restore") return;
      prompt = null;
      await restoreConnections(p.plan, p.plan.auto);
      if (p.plan.confirm.length > 0 && !unlockCancelled) {
        prompt = { stage: "prod", plan: p.plan };
        return;
      }
      focusTarget(p.plan);
      settle();
    },
    /** "Reconnect" on the PROD list. */
    async acceptProd(): Promise<void> {
      const p = prompt;
      if (!p || p.stage !== "prod") return;
      prompt = null;
      await restoreConnections(p.plan, p.plan.confirm);
      focusTarget(p.plan);
      settle();
    },
    /** "Skip these" on the PROD list: the DEV/STAGING tabs stay, the PROD ones are forgotten. */
    declineProd(): void {
      const p = prompt;
      if (!p || p.stage !== "prod") return;
      focusTarget(p.plan);
      settle();
    },
    /** "Start fresh". */
    decline(): void {
      if (prompt) settle();
    },
    saveNow,
    queueSave,
  };
}
