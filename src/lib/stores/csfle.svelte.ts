import * as api from "../api/csfle";

/** What the UI may ask about client-side field level encryption. Components go through here, never through `api/`. */
export const csfle = {
  /** Whether this build contains the feature (cached). */
  available: (): Promise<boolean> => api.csfleAvailable(),
  /** Whether the live session decrypts (it was opened with encryption configured). Never rejects. */
  async sessionEnabled(sessionId: string): Promise<boolean> {
    try {
      return (await api.csfleSessionEnabled(sessionId)) === true;
    } catch {
      return false;
    }
  },
  /** Dotted paths of the encrypted values stored in one document (empty on any failure). */
  async encryptedPaths(sessionId: string, db: string, coll: string, idJson: string): Promise<string[]> {
    try {
      return await api.csfleEncryptedPaths(sessionId, db, coll, idJson);
    } catch {
      return [];
    }
  },
};

/** Sessions whose last read fell back to ciphertext, with the libmongocrypt reason. */
export function createDecryptStatus(
  subscribe: typeof api.onDecryptUnavailable = (cb) => api.onDecryptUnavailable(cb),
  subscribeOk: typeof api.onDecryptRestored = (cb) => api.onDecryptRestored(cb),
) {
  let reasons = $state<Record<string, string>>({});
  let started = false;
  let stops: (() => void)[] = [];

  /** Starts listening (once). Safe to call from several components. */
  function start() {
    if (started) return;
    started = true;
    // A fallback raises the banner; the next clean read of that session's data clears it.
    Promise.all([
      subscribe((e) => { reasons = { ...reasons, [e.sessionId]: e.reason }; }),
      subscribeOk((sessionId) => dismiss(sessionId)),
    ])
      .then((uns) => { stops = uns; })
      .catch(() => { started = false; });
  }
  function dismiss(sessionId: string) {
    const { [sessionId]: _gone, ...rest } = reasons;
    reasons = rest;
  }
  function destroy() {
    stops.forEach((un) => un());
    stops = [];
    started = false;
  }
  return { start, dismiss, destroy, reasonFor: (sessionId: string): string | null => reasons[sessionId] ?? null };
}

export const decryptStatus = createDecryptStatus();
