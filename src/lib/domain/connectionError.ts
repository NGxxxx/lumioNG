// Turns raw MongoDB driver error strings (often long Debug-formatted dumps, e.g. topology
// errors) into short, human-readable messages for the sidebar. Pure domain logic — no
// Tauri/Svelte imports. Falls back to the original message (truncated if very long) when the
// shape isn't recognized, rather than inventing a bogus category.

const MAX_FALLBACK_LENGTH = 200;

/** Friendly message for a raw connection/query error string (from `errorMessage()` in api/errors). */
export function friendlyConnectionError(raw: string): string {
  if (/server selection timeout/i.test(raw) || /no available servers/i.test(raw)) {
    return "Can't reach the server. The connection may have dropped or the cluster is unreachable — check your network and try reconnecting.";
  }
  if (/authentication failed/i.test(raw) || /bad auth/i.test(raw)) {
    return "Authentication failed. Check your credentials and try reconnecting.";
  }
  if (/failed to lookup address/i.test(raw) || /no such host/i.test(raw) || /getaddrinfo/i.test(raw)) {
    return "Couldn't resolve the server address. Check the connection URI and your network.";
  }
  if (raw.length > MAX_FALLBACK_LENGTH) {
    return `${raw.slice(0, MAX_FALLBACK_LENGTH).trimEnd()}…`;
  }
  return raw;
}
