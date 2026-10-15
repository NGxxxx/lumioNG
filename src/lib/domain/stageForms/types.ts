export interface StageCodec<M> {
  /** null for any body the form cannot represent EXACTLY. */
  parse(body: unknown): M | null;
  build(m: M): unknown;
  summarize(m: M): string;
}

/** "$a.b" → "a.b"; null unless a plain field path (starts with a single "$", non-empty). */
export function fieldPath(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 2 || v[0] !== "$" || v[1] === "$") return null;
  return v.slice(1);
}
