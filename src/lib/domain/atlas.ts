// Pure helpers for Atlas: host detection, Atlas Search index definitions and the Admin API browser's cluster rows.

/** Whether `host` (optionally with a port) is an Atlas node: `*.mongodb.net`, never `mongodb.net` itself or a look-alike. */
export function isAtlasHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return h.length > ".mongodb.net".length && h.endsWith(".mongodb.net");
}

/** Whether any host of a `mongodb://` / `mongodb+srv://` string is an Atlas host. Credentials and options are ignored. */
export function isAtlasUri(uri: string | undefined | null): boolean {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^/?#]*@)?([^/?#]+)/i.exec((uri ?? "").trim());
  if (!m) return false;
  return m[1].split(",").some((h) => isAtlasHost(h));
}

/** The error a server that is not Atlas gives for search index commands (plain mongod, any version). */
export function isSearchUnsupported(message: string): boolean {
  return /requires additional configuration|\$listSearchIndexes|Atlas Search|CommandNotSupported|command not supported|no such command:?\s*'?(?:createSearchIndexes|updateSearchIndex|dropSearchIndex|listSearchIndexes)/i.test(message);
}

export type SearchIndexType = "search" | "vectorSearch";
export type SearchDefinitionProblem = "empty" | "json" | "object" | "searchMappings" | "vectorFields";

/** Why `text` cannot be an index definition of `type`, or null when it can. */
export function validateSearchDefinition(text: string, type: SearchIndexType): SearchDefinitionProblem | null {
  if (!text.trim()) return "empty";
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return "json";
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return "object";
  const d = v as Record<string, unknown>;
  if (Object.keys(d).length === 0) return "empty";
  if (type === "vectorSearch") return Array.isArray(d.fields) && d.fields.length > 0 ? null : "vectorFields";
  return d.mappings && typeof d.mappings === "object" ? null : "searchMappings";
}

export interface SearchTemplate {
  id: "dynamic" | "static" | "vector";
  type: SearchIndexType;
  definition: string;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** Starting points for the definition editor. */
export const SEARCH_TEMPLATES: SearchTemplate[] = [
  { id: "dynamic", type: "search", definition: pretty({ mappings: { dynamic: true } }) },
  {
    id: "static", type: "search",
    definition: pretty({ mappings: { dynamic: false, fields: { title: { type: "string" }, tags: { type: "stringFacet" } } } }),
  },
  {
    id: "vector", type: "vectorSearch",
    definition: pretty({ fields: [{ type: "vector", path: "embedding", numDimensions: 1536, similarity: "cosine" }] }),
  },
];

export interface SearchIndexRow {
  name: string;
  type: SearchIndexType | string;
  status: string;
  queryable: boolean;
  /** Pretty JSON of the latest definition. */
  definition: string;
}

/** Rows from `$listSearchIndexes` documents (ExtJSON strings); documents without a name are skipped. */
export function parseSearchIndexList(raw: string[]): SearchIndexRow[] {
  const rows: SearchIndexRow[] = [];
  for (const s of raw) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(s) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof d.name !== "string" || !d.name) continue;
    rows.push({
      name: d.name,
      type: typeof d.type === "string" ? d.type : "search",
      status: typeof d.status === "string" ? d.status : "",
      queryable: d.queryable === true,
      definition: pretty(d.latestDefinition ?? d.definition ?? {}),
    });
  }
  return rows;
}

// ---- Atlas Admin API browser ----

export interface AtlasProject {
  id: string;
  name: string;
}

export interface AtlasCluster {
  name: string;
  state: string;
  clusterType: string;
  mongoVersion: string;
  srv: string | null;
  standard: string | null;
  privateSrv: string | null;
}

/** The connection string to prefill the form with: SRV when Atlas published one. */
export function clusterUri(c: AtlasCluster): string | null {
  return c.srv ?? c.standard;
}

export function clusterStatus(c: AtlasCluster): "ready" | "noConnection" {
  return clusterUri(c) ? "ready" : "noConnection";
}
