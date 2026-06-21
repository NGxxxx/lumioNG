import { serverStatus, buildInfo, hostInfo } from "../api/server";
import { parseHostInfo, type HostInfo } from "../domain/host";
import { errorMessage } from "../api/errors";

/** Loads + holds curated server metrics; feeds the Host tab and the status bar. */
export function createHostStatus() {
  let info = $state<HostInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      const [ss, bi] = await Promise.all([serverStatus(), buildInfo()]);
      // hostInfo may require privileges the user lacks → treat as absent.
      let hi: string | null = null;
      try {
        hi = await hostInfo();
      } catch {
        hi = null;
      }
      info = parseHostInfo(ss, bi, hi);
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

/** Singleton used by the app (tests build their own via createHostStatus). */
export const hostStatus = createHostStatus();
