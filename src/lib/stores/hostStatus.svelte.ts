import { serverStatus, buildInfo, hostInfo } from "../api/mongoServer";
import { parseHostInfo, type HostInfo } from "../domain/host";
import { errorMessage } from "../api/errors";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** Loads + holds curated server metrics; feeds the Host tab and the status bar. */
export function createHostStatus(sessionId: string) {
  let info = $state<HostInfo | null>(null);
  const guard = createAsyncGuard();

  async function load() {
    const gen = guard.begin();
    try {
      // serverStatus/hostInfo may require privileges the user lacks → treat either as absent rather than failing the tab; buildInfo's rejection means the connection itself is broken.
      const [biResult, ssResult, hiResult] = await Promise.allSettled([
        buildInfo(sessionId),
        serverStatus(sessionId),
        hostInfo(sessionId),
      ]);
      if (!guard.isCurrent(gen)) return;
      if (biResult.status === "rejected") throw biResult.reason;
      const ss = ssResult.status === "fulfilled" ? ssResult.value : null;
      const hi = hiResult.status === "fulfilled" ? hiResult.value : null;
      info = parseHostInfo(ss, biResult.value, hi);
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      guard.setError(errorMessage(e));
    } finally {
      guard.finish(gen);
    }
  }

  function clear() {
    guard.invalidate(); // an in-flight load must not repopulate the view after a disconnect
    info = null;
    guard.setError(null);
    guard.setLoading(false);
  }

  return {
    get info() { return info; },
    get error() { return guard.error; },
    get loading() { return guard.loading; },
    load,
    clear,
  };
}

/** Singleton used by not-yet-migrated modules (tests build their own via createHostStatus). */
export const hostStatus = createHostStatus("");
