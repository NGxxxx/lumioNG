/**
 * Reference target resolution: given an ObjectId (or DBRef) value at a field path, work out which
 * collection(s) it most likely points to. Pure — no Tauri, no Svelte.
 */

export type RefTarget = { db: string; coll: string };

export type RefResolution =
  | { kind: "one"; target: RefTarget; reason: "dbref" | "remembered" | "guessed" }
  | { kind: "many"; targets: RefTarget[] }
  | { kind: "none" };

const OID_RE = /^[0-9a-fA-F]{24}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isObjectId(v: unknown): boolean {
  return isObject(v) && typeof v.$oid === "string" && OID_RE.test(v.$oid);
}

function asDbRef(v: unknown): { ref: string; id: unknown; db: string | null } | null {
  if (!isObject(v) || typeof v.$ref !== "string" || !("$id" in v) || v.$id === undefined) return null;
  return { ref: v.$ref, id: v.$id, db: typeof v.$db === "string" ? v.$db : null };
}

/** Canonical ExtJSON text of an ObjectId value, or of a DBRef's `$id`; null otherwise. */
export function refIdText(value: unknown): string | null {
  if (isObjectId(value)) return JSON.stringify(value);
  const ref = asDbRef(value);
  if (ref) return JSON.stringify(ref.id);
  return null;
}

/** True only for the document's own top-level `_id`. */
export function isSelfId(path: string): boolean {
  return path === "_id";
}

/** Key under which a chosen target collection is remembered. */
export function memoryKey(connId: number | null, db: string, coll: string, path: string): string {
  return `${connId ?? "-"}|${db}|${coll}|${path}`;
}

const IRREGULAR: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  mouse: "mice",
  datum: "data",
  index: "indices",
  status: "statuses",
};
const IRREGULAR_SINGULAR: Record<string, string> = Object.fromEntries(
  Object.entries(IRREGULAR).map(([s, p]) => [p, s]),
);

const ID_SUFFIXES = ["_ids", "Ids", "_id", "Id", "ID"];

function stripIdSuffix(field: string): string {
  for (const suf of ID_SUFFIXES) {
    if (field.length > suf.length && field.endsWith(suf)) return field.slice(0, -suf.length);
  }
  return field;
}

function pluralize(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

function singularize(w: string): string | null {
  if (IRREGULAR_SINGULAR[w]) return IRREGULAR_SINGULAR[w];
  if (IRREGULAR[w]) return null; // already a known singular (e.g. "status")
  if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return null;
}

/** Split camelCase / snake_case into lower-cased words. */
function words(base: string): string[] {
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Candidate collection names (lower-cased, deduplicated) for a field name. */
export function nameForms(field: string): string[] {
  const base = stripIdSuffix(field);
  const out = new Set<string>();
  out.add(base.toLowerCase());
  const ws = words(base);
  if (ws.length === 0) return [...out];
  const head = ws.slice(0, -1);
  const last = ws[ws.length - 1];
  const lastForms = [last, pluralize(last)];
  const sing = singularize(last);
  if (sing) lastForms.push(sing);
  for (const lf of lastForms) {
    const parts = [...head, lf];
    out.add(parts.join(""));
    out.add(parts.join("_"));
  }
  return [...out];
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * Resolve where a reference value points. Priority: DBRef → remembered (if still present) → name
 * guess against the same database's collection names.
 */
export function resolveRef(
  input: { path: string; value: unknown; db: string; coll: string },
  collections: string[],
  remembered: string | null,
): RefResolution {
  if (isSelfId(input.path)) return { kind: "none" };
  if (refIdText(input.value) === null) return { kind: "none" };

  const ref = asDbRef(input.value);
  if (ref) {
    return { kind: "one", target: { db: ref.db ?? input.db, coll: ref.ref }, reason: "dbref" };
  }

  if (remembered !== null && collections.includes(remembered)) {
    return { kind: "one", target: { db: input.db, coll: remembered }, reason: "remembered" };
  }

  const forms = new Set(nameForms(lastSegment(input.path)));
  const seen = new Set<string>();
  const targets: RefTarget[] = [];
  for (const c of collections) {
    if (seen.has(c) || !forms.has(c.toLowerCase())) continue;
    seen.add(c);
    targets.push({ db: input.db, coll: c });
  }
  if (targets.length === 0) return { kind: "none" };
  if (targets.length === 1) return { kind: "one", target: targets[0], reason: "guessed" };
  return { kind: "many", targets };
}

/**
 * The value a reference jump would follow from a cell: an ObjectId or DBRef, or the single element of
 * a one-element array of them. null when there is nothing to follow (never for `_id` itself).
 */
export function followableValue(path: string, value: unknown): unknown | null {
  if (isSelfId(path)) return null;
  if (refIdText(value) !== null) return value;
  if (Array.isArray(value) && value.length === 1 && refIdText(value[0]) !== null) return value[0];
  return null;
}

/** For the `g` key: the preferred column when it is followable, else the first followable column. */
export function firstFollowable(
  doc: Record<string, unknown>,
  paths: string[],
  get: (doc: Record<string, unknown>, path: string) => unknown,
  preferred: string | null = null,
): { path: string; value: unknown } | null {
  const order = preferred && paths.includes(preferred) ? [preferred, ...paths.filter((p) => p !== preferred)] : paths;
  for (const path of order) {
    const v = followableValue(path, get(doc, path));
    if (v !== null) return { path, value: v };
  }
  return null;
}

/** A field path without array indexes (`items.2.productId` → `items.productId`): the field a reference
 * belongs to, for guessing and for remembering, whichever element was clicked. */
export function normalizeRefPath(path: string): string {
  return path.split(".").filter((s) => !/^\d+$/.test(s)).join(".");
}
