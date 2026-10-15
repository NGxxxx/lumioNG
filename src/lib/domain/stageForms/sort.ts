import { isPlainObject } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

export type SortModel = { field: string; dir: 1 | -1 }[];

export const sortCodec: StageCodec<SortModel> = {
  parse(body) {
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    if (keys.length === 0) return null; // an empty $sort is invalid in MongoDB
    const out: SortModel = [];
    for (const k of keys) {
      const v = body[k];
      if (v !== 1 && v !== -1) return null;
      out.push({ field: k, dir: v });
    }
    return out;
  },
  build: (m) => Object.fromEntries(m.map((s) => [s.field, s.dir])),
  summarize: (m) => m.map((s) => `${s.field} ${s.dir === -1 ? "↓" : "↑"}`).join(", "),
};
