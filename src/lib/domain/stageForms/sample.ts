import { isPlainObject } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

/** `$sample: { size }` ↔ the size. */
export const sampleCodec: StageCodec<number> = {
  parse(body) {
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "size") return null;
    const n = body.size;
    return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : null;
  },
  build: (n) => ({ size: n }),
  summarize: (n) => `${n} random`,
};
