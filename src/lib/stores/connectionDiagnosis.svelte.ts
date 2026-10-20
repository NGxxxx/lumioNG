import { errorMessage } from "../api/errors";
import { diagnosisVerdict, type DiagStep } from "../domain/connectionDiag";

/** Runs a connection diagnosis and holds its steps for the dialog (see `TestConnectionDialog`). */
export function createConnectionDiagnosis(run: () => Promise<DiagStep[]>) {
  let steps = $state.raw<DiagStep[]>([]);
  let running = $state(false);
  let finished = $state(false);
  let error = $state<string | null>(null);

  async function start() {
    if (running) return;
    running = true;
    finished = false;
    error = null;
    steps = [];
    try {
      steps = await run();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      running = false;
      finished = true;
    }
  }

  return {
    get steps() { return steps; },
    get running() { return running; },
    get finished() { return finished; },
    get error() { return error; },
    /** The step the diagnosis stopped at, or null while running / when everything passed. */
    get verdict() { return diagnosisVerdict(steps); },
    start,
  };
}
