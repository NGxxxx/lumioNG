/** Build the "conn \ db \ coll" breadcrumb string for the top bar. Pure. */
export function buildBreadcrumb(p: { conn: string | null; db?: string | null; coll?: string | null }): string {
  if (!p.conn) return "Not connected";
  const parts = [p.conn];
  if (p.db) {
    parts.push(p.db);
    if (p.coll) parts.push(p.coll);
  }
  return parts.join(" \\ ");
}
