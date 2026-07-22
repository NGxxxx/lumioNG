// Turns raw MongoDB driver error strings into short, human-readable messages for the sidebar; falls back to the (truncated) original message.

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
  const dupKey = raw.match(/E11000 duplicate key error collection: \S+ index: (\S+)/i);
  if (dupKey) {
    return `A document with this value already exists (duplicate key on index "${dupKey[1]}").`;
  }
  if (/E11000 duplicate key/i.test(raw)) {
    return "A document with this value already exists (duplicate key).";
  }
  if (/failed validation/i.test(raw)) {
    return "This document doesn't satisfy the collection's validation rules.";
  }
  if (raw.length > MAX_FALLBACK_LENGTH) {
    return `${raw.slice(0, MAX_FALLBACK_LENGTH).trimEnd()}…`;
  }
  return raw;
}
