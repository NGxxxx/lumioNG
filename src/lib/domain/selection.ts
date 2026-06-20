/** Inclusive index range between a and b, ascending; order-independent. */
export function rangeBetween(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/**
 * Build an {_id:{$in:[…]}} Canonical Extended JSON filter string from a list of
 * id ExtJSON strings. Caller guarantees `idJsons` is non-empty and every entry
 * is valid id Extended JSON (as produced by domain/docid `idJson`).
 */
export function idInFilter(idJsons: string[]): string {
  return `{"_id":{"$in":[${idJsons.join(",")}]}}`;
}
