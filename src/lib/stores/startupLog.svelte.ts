import { startupLog as fetchStartupLog } from "../api/server";
import { parseStartupLog, type StartupLogEntry } from "../domain/host";
import { errorMessage } from "../api/errors";

/** Loads + holds `local.startup_log` (restart history) for the Host tab's "Server info" sub-tab. */
export function createStartupLog(sessionId: string) {
  let entries = $state.raw<StartupLogEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      entries = parseStartupLog(await fetchStartupLog(sessionId));
      error = null;
    } catch (e) {
      // Reading `local` can be denied by the user's role — treat as an empty, non-fatal result.
      entries = [];
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  return {
    get entries() { return entries; },
    get loading() { return loading; },
    get error() { return error; },
    load,
  };
}
