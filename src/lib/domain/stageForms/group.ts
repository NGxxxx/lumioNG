import { isPlainObject } from "./deepEqualOrdered";
import { fieldPath, type StageCodec } from "./types";

export type GroupOp = "count" | "sum" | "avg" | "min" | "max" | "first" | "last" | "push" | "addToSet";
export type GroupModel = {
  by: string[] | null;
  accumulators: { name: string; op: GroupOp; field?: string }[];
};

const OPS: Record<string, GroupOp> = {
  $sum: "sum", $avg: "avg", $min: "min", $max: "max",
  $first: "first", $last: "last", $push: "push", $addToSet: "addToSet",
};
const lastSegment = (f: string) => f.split(".").pop() as string;

function parseBy(id: unknown): string[] | null | undefined {
  if (id === null) return null;
  const single = fieldPath(id);
  if (single !== null) return [single];
  if (!isPlainObject(id)) return undefined;
  const keys = Object.keys(id);
  // a single-key object would rebuild as "$f" (not byte-identical) → unsupported
  if (keys.length < 2) return undefined;
  const out: string[] = [];
  for (const k of keys) {
    const f = fieldPath(id[k]);
    if (f === null || lastSegment(f) !== k) return undefined;
    out.push(f);
  }
  return out;
}

export const groupCodec: StageCodec<GroupModel> = {
  parse(body) {
    if (!isPlainObject(body)) return null;
    const keys = Object.keys(body);
    // `_id` must be the first key: build always emits it first (key order is part of the law)
    if (keys[0] !== "_id") return null;
    const by = parseBy(body._id);
    if (by === undefined) return null;
    const accumulators: GroupModel["accumulators"] = [];
    for (const name of keys.slice(1)) {
      const acc = body[name];
      if (!isPlainObject(acc)) return null;
      const ak = Object.keys(acc);
      if (ak.length !== 1) return null;
      const operand = acc[ak[0]];
      if (ak[0] === "$sum" && operand === 1 && typeof operand === "number") {
        accumulators.push({ name, op: "count" });
        continue;
      }
      const op = OPS[ak[0]];
      const f = fieldPath(operand);
      if (!op || f === null) return null;
      accumulators.push({ name, op, field: f });
    }
    return { by, accumulators };
  },
  build(m) {
    const out: Record<string, unknown> = {};
    if (m.by === null || m.by.length === 0) out._id = null;
    else if (m.by.length === 1) out._id = "$" + m.by[0];
    else out._id = Object.fromEntries(m.by.map((f) => [lastSegment(f), "$" + f]));
    for (const a of m.accumulators) {
      out[a.name] =
        a.op === "count" ? { $sum: 1 } : { ["$" + a.op]: "$" + (a.field ?? "") };
    }
    return out;
  },
  summarize(m) {
    const by = m.by && m.by.length ? "by " + m.by.join(", ") : "all documents";
    if (!m.accumulators.length) return by;
    const accs = m.accumulators.map((a) => (a.op === "count" ? "count" : `${a.op}(${a.field ?? ""})`));
    return `${by} · ${accs.join(", ")}`;
  },
};
