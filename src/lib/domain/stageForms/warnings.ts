import { isPlainObject } from "./deepEqualOrdered";

const RESHAPE = new Set(["$group", "$project", "$unwind", "$addFields", "$set", "$lookup"]);

/** Non-blocking warnings; `index` is into the given array. Disabled stages are ignored. */
export function stageWarnings(
  stages: { name: string; body: unknown; enabled: boolean }[],
  indexedFields: (coll: string) => string[] | null,
): { index: number; key: string }[] {
  const out: { index: number; key: string }[] = [];
  let reshaped = false;
  stages.forEach((s, index) => {
    if (!s.enabled) return;
    if (s.name === "$match" && reshaped) out.push({ index, key: "match_after_reshape" });
    if (s.name === "$lookup" && isPlainObject(s.body)) {
      const { from, foreignField } = s.body;
      if (typeof from === "string" && typeof foreignField === "string" && foreignField !== "_id") {
        const idx = indexedFields(from);
        if (idx !== null && !idx.includes(foreignField)) out.push({ index, key: "lookup_unindexed" });
      }
    }
    if (s.name === "$out" || s.name === "$merge") out.push({ index, key: "writes_disable_preview" });
    if (RESHAPE.has(s.name)) reshaped = true;
  });
  return out;
}
