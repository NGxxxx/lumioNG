import { isPlainObject } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

export type LookupModel = { from: string; localField: string; foreignField: string; as: string };

const ORDER = ["from", "localField", "foreignField", "as"] as const;

export const lookupCodec: StageCodec<LookupModel> = {
  parse(body) {
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    // exactly these four keys, in this order (other orders would not round-trip → JSON)
    if (keys.length !== 4 || ORDER.some((k, i) => keys[i] !== k)) return null;
    if (ORDER.some((k) => typeof body[k] !== "string")) return null;
    return {
      from: body.from as string,
      localField: body.localField as string,
      foreignField: body.foreignField as string,
      as: body.as as string,
    };
  },
  build: (m) => ({ from: m.from, localField: m.localField, foreignField: m.foreignField, as: m.as }),
  summarize: (m) => `${m.localField} → ${m.from}.${m.foreignField} as ${m.as}`,
};
