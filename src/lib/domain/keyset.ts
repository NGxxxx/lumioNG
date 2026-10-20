/** Keyset (seek) paging plan for the collection grid: pure, no Tauri/Svelte. */
import type { SortKey } from "./grid";
import { skipFor } from "./paging";

/** A `skip` beyond this makes the server walk that many index entries/docs -> show the "deep page is slow" hint. */
export const DEEP_SKIP_HINT_THRESHOLD = 100_000;

export interface PageFetchInput {
  sort: SortKey[];
  fromPage: number;
  toPage: number;
  pageSize: number;
  /** `_id` (Canonical ExtJSON, verbatim) of the first/last doc of the loaded page `fromPage`; null when unknown. */
  boundary: { firstId: unknown; lastId: unknown } | null;
}

export type PageFetchPlan =
  | { kind: "keyset"; filterPatch: Record<string, unknown>; reverse: boolean }
  | { kind: "skip"; skip: number };

/** Direction of a pure `_id` ordering (empty sort = server default `{_id:1}`); null when the order involves other fields. */
export function keysetSortDir(sort: SortKey[]): 1 | -1 | null {
  if (sort.length === 0) return 1;
  if (sort.length === 1 && sort[0].path === "_id") return sort[0].dir;
  return null;
}

/**
 * Decide how to fetch `toPage`. Keyset only for an adjacent move off a loaded page under a pure
 * `_id` sort; everything else (far jump, other sort, page 1, no boundary) falls back to `skip`.
 * `$gt`/`$lt` compare within one BSON type, so callers must verify the keyset page is full and
 * fall back to skip when it is short (mixed-type `_id` collections).
 */
export function planPageFetch(input: PageFetchInput): PageFetchPlan {
  const { sort, fromPage, toPage, pageSize, boundary } = input;
  const skip: PageFetchPlan = { kind: "skip", skip: skipFor(toPage, pageSize) };
  const dir = keysetSortDir(sort);
  if (dir === null || boundary === null || toPage <= 1) return skip;
  const forward = toPage === fromPage + 1;
  const backward = toPage === fromPage - 1;
  if (!forward && !backward) return skip;
  const id = forward ? boundary.lastId : boundary.firstId;
  if (id === undefined) return skip;
  // Moving "later" in sort order uses $gt for asc / $lt for desc; backward is the mirror.
  const op = (dir === 1) === forward ? "$gt" : "$lt";
  return { kind: "keyset", filterPatch: { _id: { [op]: id } }, reverse: backward };
}
