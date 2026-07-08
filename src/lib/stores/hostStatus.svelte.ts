import { serverStatus, buildInfo, hostInfo } from "../api/server";
import { parseHostInfo, type HostInfo } from "../domain/host";
import { errorMessage } from "../api/errors";

/** Loads + holds curated server metrics; feeds the Host tab and the status bar. */
export function createHostStatus(sessionId: string) {
  let info = $state<HostInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      // serverStatus and hostInfo may require privileges the connected user lacks (common on
      // restricted-access/shared clusters) → treat either as absent rather than failing the
      // whole tab. buildInfo needs no special privilege; its rejection means the connection
      // itself is broken, so it's left to surface as a real error.
      const [biResult, ssResult, hiResult] = await Promise.allSettled([
        buildInfo(sessionId),
        serverStatus(sessionId),
        hostInfo(sessionId),
      ]);
      if (biResult.status === "rejected") throw biResult.reason;
      const ss = ssResult.status === "fulfilled" ? ssResult.value : null;
      const hi = hiResult.status === "fulfilled" ? hiResult.value : null;
      info = parseHostInfo(ss, biResult.value, hi);
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function clear() {
    info = null;
    error = null;
  }

  return {
    get info() { return info; },
    get error() { return error; },
    get loading() { return loading; },
    load,
    clear,
  };
}

/** Singleton used by not-yet-migrated modules (tests build their own via createHostStatus). */
export const hostStatus = createHostStatus("");
