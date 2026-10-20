import { classifyError, truncateError } from "../domain/connectionError";
import { msgKey } from "../msgkey";

export interface AppErrorShape {
  kind: "Connection" | "SshTunnel" | "Query" | "Serialize" | "Parse" | "Io" | "Vault" | "NotConnected";
  message?: string;
}

/** The untranslated driver error text — match on this, never on the localized `errorMessage`. */
export function rawErrorText(e: unknown): string {
  if (e && typeof e === "object" && "kind" in e) {
    const err = e as AppErrorShape;
    return err.message ? `${err.kind}: ${err.message}` : err.kind;
  }
  return String(e);
}

/** User-facing message: a localized explanation for recognized driver errors, else the (truncated) raw text. */
export function errorMessage(e: unknown): string {
  if (!(e && typeof e === "object" && "kind" in e)) return String(e);
  const raw = rawErrorText(e);
  const known = classifyError(raw);
  return known ? msgKey(known.key, known.params) : truncateError(raw);
}
