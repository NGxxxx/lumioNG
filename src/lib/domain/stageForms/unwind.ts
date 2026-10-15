import { isPlainObject } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

export type UnwindModel = { path: string; preserve: boolean };

export const unwindCodec: StageCodec<UnwindModel> = {
  parse(body) {
    if (typeof body === "string") {
      return body.length > 1 && body[0] === "$" ? { path: body.slice(1), preserve: false } : null;
    }
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    // Only the exact `{path, preserveNullAndEmptyArrays: true}` shape: `preserve:false` is built as the
    // string form and the other key order would not round-trip, so those stay JSON.
    if (keys.length !== 2 || keys[0] !== "path" || keys[1] !== "preserveNullAndEmptyArrays") return null;
    const p = body.path;
    if (typeof p !== "string" || p.length < 2 || p[0] !== "$") return null;
    if (body.preserveNullAndEmptyArrays !== true) return null;
    return { path: p.slice(1), preserve: true };
  },
  build: (m) =>
    m.preserve
      ? { path: "$" + m.path, preserveNullAndEmptyArrays: true }
      : "$" + m.path,
  summarize: (m) => m.path + (m.preserve ? " (keep empty)" : ""),
};
