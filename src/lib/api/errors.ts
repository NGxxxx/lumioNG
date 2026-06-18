export interface AppErrorShape {
  kind: "Connection" | "Query" | "Serialize" | "Parse" | "Io" | "NotConnected";
  message?: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "kind" in e) {
    const err = e as AppErrorShape;
    return err.message ? `${err.kind}: ${err.message}` : err.kind;
  }
  return String(e);
}
