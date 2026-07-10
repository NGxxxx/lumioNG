import { describeValue } from "./extjson";
import { getByPath, type ColumnField } from "./schema";
import type { Doc } from "./doc";

/** Compile a user-typed quick-search term into a case-insensitive RegExp; returns null for an empty or invalid pattern, and callers surface invalidity separately. */
export function compileSearch(term: string): RegExp | null {
  if (term === "") return null;
  try {
    return new RegExp(term, "i");
  } catch {
    return null;
  }
}

/** True if any of `columns`' displayed value (same text the grid renders) in `doc` matches `re`. */
export function docMatchesSearch(doc: Doc, columns: Pick<ColumnField, "path">[], re: RegExp): boolean {
  return columns.some((c) => re.test(describeValue(getByPath(doc, c.path)).display));
}

/** Indices into `docs` whose row matches `re`; `re === null` means "no filter" and returns null, matching `GridPageView.visibleIndices`'s null-means-unfiltered contract. */
export function matchingIndices(
  docs: Doc[],
  columns: Pick<ColumnField, "path">[],
  re: RegExp | null,
): number[] | null {
  if (!re) return null;
  const out: number[] = [];
  docs.forEach((d, i) => {
    if (docMatchesSearch(d, columns, re)) out.push(i);
  });
  return out;
}
