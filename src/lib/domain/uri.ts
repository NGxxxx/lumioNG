/** Mask the password in a connection URI's userinfo: scheme://user:pass@host → scheme://user:****@host.
 *  Auth-less or password-less URIs are returned unchanged. Pure; no network. */
export function maskUri(uri: string): string {
  // Match "scheme://" then "user:pass@" (password is the masked group).
  return uri.replace(
    /^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]+):[^/?#@]*@/i,
    "$1:****@",
  );
}
