// A connection string handed from one screen to the connection form (e.g. the Atlas browser on the
// welcome screen -> the session manager). Taken once; never holds a password (Atlas gives none).
export interface ConnectionPrefill {
  uri: string;
  label: string;
}

let pending: ConnectionPrefill | null = null;

export const connectionPrefill = {
  set(p: ConnectionPrefill) {
    pending = p;
  },
  /** Returns the pending prefill and clears it. */
  take(): ConnectionPrefill | null {
    const p = pending;
    pending = null;
    return p;
  },
};
