import { errorMessage } from "../api/errors";

/** Shared busy/error bookkeeping for a dialog's async submit/confirm action: sets `busy` while in
 *  flight, clears `error` at the start, and reports a thrown error's message on failure. */
export function createAsyncSubmit(action: () => Promise<void>) {
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit() {
    busy = true;
    error = null;
    try {
      await action();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  return {
    get busy() { return busy; },
    get error() { return error; },
    submit,
  };
}
