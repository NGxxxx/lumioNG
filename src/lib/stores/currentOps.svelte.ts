import { currentOps as fetchCurrentOps, killOp } from "../api/server";
import { parseCurrentOps, type OpInfo } from "../domain/host";
import { errorMessage } from "../api/errors";

/** Loads + holds the live `currentOp` list for the Host tab's "Current Operations" sub-tab; kill() re-loads on success. */
export function createCurrentOps(sessionId: string) {
  let ops = $state.raw<OpInfo[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let killing = $state<number | null>(null);

  async function load() {
    loading = true;
    try {
      ops = parseCurrentOps(await fetchCurrentOps(sessionId));
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function kill(opid: number) {
    killing = opid;
    try {
      await killOp(sessionId, opid);
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      killing = null;
    }
  }

  return {
    get ops() { return ops; },
    get loading() { return loading; },
    get error() { return error; },
    get killing() { return killing; },
    load,
    kill,
  };
}
