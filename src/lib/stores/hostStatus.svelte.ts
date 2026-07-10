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
      // serverStatus/hostInfo may require privileges the user lacks → treat either as absent rather than failing the tab; buildInfo's rejection means the connection itself is broken.
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
