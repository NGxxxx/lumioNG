import type { DbInfo } from "../api/connection";

export interface NsFilterResult {
  databases: DbInfo[];
  expand: Set<string>;
}

/** Filter a namespace tree by a case-insensitive substring over db + collection names. */
export function filterNamespaces(databases: DbInfo[], query: string): NsFilterResult {
  const q = query.trim().toLowerCase();
  if (q === "") return { databases, expand: new Set() };

  const out: DbInfo[] = [];
  const expand = new Set<string>();
  for (const db of databases) {
    const nameMatch = db.name.toLowerCase().includes(q);
    const matchedColls = db.collections.filter((c) => c.toLowerCase().includes(q));
    if (nameMatch) {
      out.push(db);
      if (matchedColls.length > 0) expand.add(db.name);
    } else if (matchedColls.length > 0) {
      out.push({ ...db, collections: matchedColls });
      expand.add(db.name);
    }
  }
  return { databases: out, expand };
}
