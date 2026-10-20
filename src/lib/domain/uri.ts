/** Masks the password of every `mongodb://` / `mongodb+srv://` URI inside free text (a query or filter). */
export function maskUrisInText(text: string): string {
  return text.replace(/(mongodb(?:\+srv)?:\/\/[^\s/?#@:'"`]+):[^\s/?#@'"`]*@/gi, "$1:****@");
}

/** Mask the password in a connection URI's userinfo: scheme://user:pass@host → scheme://user:****@host.
 *  Auth-less or password-less URIs are returned unchanged. Pure; no network. */
export function maskUri(uri: string): string {
  // Match "scheme://" then "user:pass@" (password is the masked group).
  return uri
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]+):[^/?#@]*@/i, "$1:****@")
    // Secrets that travel as options: proxyPassword=…, tlsCertificateKeyFilePassword=…, AWS_SESSION_TOKEN:…
    .replace(/([?&](?:proxyPassword|tlsCertificateKeyFilePassword)=)[^&]*/gi, "$1****")
    .replace(/(AWS_SESSION_TOKEN:)[^,&]*/gi, "$1****");
}
