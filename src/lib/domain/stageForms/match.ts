import { chipsFromFilter, filterFromChips, type Chip } from "../filterChips";
import { chipParts } from "../chipText";
import { deepEqualOrdered } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

const OP_TEXT: Partial<Record<Chip["op"], string>> = {
  eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "in", contains: "contains", startsWith: "starts with",
  exists: "exists", notExists: "missing", between: "between", size: "size", isTrue: "is true", isFalse: "is false",
};

/** `$match` body ↔ the same chips as the Data tab filter. */
export const matchCodec: StageCodec<Chip[]> = {
  parse(body) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    const chips = chipsFromFilter(JSON.stringify(body));
    if (chips === null) return null;
    // Exactness: only accept bodies the chips rebuild identically (key order included).
    return deepEqualOrdered(JSON.parse(filterFromChips(chips)), body) ? chips : null;
  },
  build(chips) {
    return JSON.parse(filterFromChips(chips)) as unknown;
  },
  summarize(chips) {
    if (chips.length === 0) return "all documents";
    return chips.map((c) => { const p = chipParts(c); return `${p.field} ${OP_TEXT[p.op] ?? p.op}${p.value ? ` ${p.value}` : ""}`; }).join(", ");
  },
};
