/** Dựng chuỗi breadcrumb "conn \ db \ coll" cho thanh trên cùng. Thuần. */
export function buildBreadcrumb(p: { conn: string | null; db?: string | null; coll?: string | null }): string {
  if (!p.conn) return "Not connected";
  const parts = [p.conn];
  if (p.db) {
    parts.push(p.db);
    if (p.coll) parts.push(p.coll);
  }
  return parts.join(" \\ ");
}
