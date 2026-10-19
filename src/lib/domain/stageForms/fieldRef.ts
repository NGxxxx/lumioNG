import { isPlainObject } from "./deepEqualOrdered";
import { fieldPath, type StageCodec } from "./types";

/** `$sortByCount: "$path"` ↔ the path. */
export const sortByCountCodec: StageCodec<string> = {
  parse: (body) => fieldPath(body),
  build: (p) => "$" + p,
  summarize: (p) => `by ${p}`,
};

/** `$replaceRoot: { newRoot: "$path" }` ↔ the path (computed roots stay JSON). */
export const replaceRootCodec: StageCodec<string> = {
  parse(body) {
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    return keys.length === 1 && keys[0] === "newRoot" ? fieldPath(body.newRoot) : null;
  },
  build: (p) => ({ newRoot: "$" + p }),
  summarize: (p) => `promote ${p}`,
};

/** `$unset: "a"` or `$unset: ["a", "b"]` ↔ the field list. A one-element array would rebuild as the
 *  bare string, so it stays JSON. */
export const unsetCodec: StageCodec<string[]> = {
  parse(body) {
    if (typeof body === "string") return body.length > 0 ? [body] : null;
    if (!Array.isArray(body) || body.length < 2) return null;
    return body.every((f) => typeof f === "string" && f.length > 0) ? (body as string[]) : null;
  },
  build: (fields) => (fields.length === 1 ? fields[0] : fields),
  summarize: (fields) => fields.join(", "),
};
