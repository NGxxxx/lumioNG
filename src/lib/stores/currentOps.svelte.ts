import { currentOps as fetchCurrentOps, killOp } from "../api/server";
import { parseCurrentOps, type OpInfo } from "../domain/host";
import { errorMessage } from "../api/errors";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** Loads + holds the live `currentOp` list for the Host tab's "Current Operations" sub-tab; kill() re-loads on success. */
export function createCurrentOps(sessionId: string) {
  let ops = $state.raw<OpInfo[]>([]);
  let killing = $state<number | null>(null);
  const guard = createAsyncGuard();

  async function load() {
    const gen = guard.begin();
    try {
      const raw = await fetchCurrentOps(sessionId);
      if (!guard.isCurrent(gen)) return;
      ops = parseCurrentOps(raw);
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      guard.setError(errorMessage(e));
    } finally {
      guard.finish(gen);
    }
  }

  async function kill(opid: number) {
    killing = opid;
    try {
      await killOp(sessionId, opid);
      await load();
    } catch (e) {
      guard.setError(errorMessage(e));
    } finally {
      killing = null;
    }
  }

  return {
    get ops() { return ops; },
    get loading() { return guard.loading; },
    get error() { return guard.error; },
    get killing() { return killing; },
    load,
    kill,
  };
}
