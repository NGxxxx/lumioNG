// Recognizes common raw MongoDB driver errors so the UI can show a short, actionable, localized message.

const MAX_FALLBACK_LENGTH = 200;

/** A message key (resolved by the caller via `msgKey`) plus its params. */
export interface FriendlyError {
  key: string;
  params?: Record<string, string>;
}

/** The friendly message for a raw error string (`Kind: message`), or null when it isn't recognized. */
export function classifyError(raw: string): FriendlyError | null {
  // Query errors first: their text embeds user names (collections, values) that could trip the patterns below.
  const dupKey = raw.match(/E11000 duplicate key error collection: \S+ index: (\S+)/i);
  if (dupKey) return { key: "err_dup_key_index", params: { index: dupKey[1] } };
  if (/E11000 duplicate key/i.test(raw)) return { key: "err_dup_key" };
  if (/document failed validation/i.test(raw)) return { key: "err_validation_failed" };
  const plaintext = raw.match(/csfle_plaintext_required:(\S+)/);
  if (plaintext) return { key: "err_csfle_plaintext_required", params: { paths: plaintext[1] } };
  const unauthorized = raw.match(/not authorized on (\S+) to execute/i);
  if (unauthorized) return { key: "err_not_authorized", params: { db: unauthorized[1] } };

  if (/connection refused|actively refused|os error 111\b|os error 10061\b/i.test(raw)) return { key: "err_conn_refused" };
  if (/invalid peer certificate|certificate verify|tls handshake|InvalidContentType|ssl routines/i.test(raw)) return { key: "err_conn_tls" };
  if (/server selection timeout|no available servers/i.test(raw)) {
    return { key: /\.mongodb\.net\b/i.test(raw) ? "err_conn_atlas_unreachable" : "err_conn_unreachable" };
  }
  if (/authentication failed|bad auth/i.test(raw)) return { key: "err_auth_failed" };
  if (/failed to lookup address|no such host|getaddrinfo/i.test(raw)) return { key: "err_conn_dns" };
  return null;
}

/** Shortens an unrecognized message so a topology dump can't blow out the layout. */
export function truncateError(raw: string): string {
  return raw.length > MAX_FALLBACK_LENGTH ? `${raw.slice(0, MAX_FALLBACK_LENGTH).trimEnd()}…` : raw;
}
