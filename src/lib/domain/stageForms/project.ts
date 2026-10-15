import { deepEqualOrdered, isPlainObject } from "./deepEqualOrdered";
import type { StageCodec } from "./types";

export type ProjectModel = {
  field: string;
  mode: "include" | "exclude" | "rename" | "expr";
  value?: string;
}[];

/** `allowFlags`: only `$project` has include/exclude; in `$addFields`/`$set` a literal 1/0 is an expr. */
function makeCodec(allowFlags: boolean): StageCodec<ProjectModel> {
  return {
    parse(body) {
      if (!isPlainObject(body)) return null;
      const keys = Object.keys(body);
      if (keys.length === 0) return null;
      const out: ProjectModel = [];
      for (const field of keys) {
        const v = body[field];
        if (allowFlags && v === 1) out.push({ field, mode: "include" });
        else if (allowFlags && v === 0) out.push({ field, mode: "exclude" });
        else if (typeof v === "string" && v.startsWith("$")) {
          out.push({ field, mode: "rename", value: v.slice(1) });
        } else {
          // nested plain object that is not an operator expression ({a: {b: 1}}) is a sub-projection
          if (isPlainObject(v)) {
            const first = Object.keys(v)[0];
            if (first === undefined || !first.startsWith("$")) return null;
          }
          const text = JSON.stringify(v);
          if (typeof text !== "string" || !deepEqualOrdered(JSON.parse(text), v)) return null;
          out.push({ field, mode: "expr", value: text });
        }
      }
      return out;
    },
    build(m) {
      const out: Record<string, unknown> = {};
      for (const p of m) {
        if (p.mode === "include") out[p.field] = 1;
        else if (p.mode === "exclude") out[p.field] = 0;
        else if (p.mode === "rename") out[p.field] = "$" + (p.value ?? "");
        else {
          try {
            out[p.field] = JSON.parse(p.value ?? "");
          } catch {
            out[p.field] = p.value ?? ""; // half-typed expression: keep as a string literal
          }
        }
      }
      return out;
    },
    summarize(m) {
      const names = (mode: string) => m.filter((p) => p.mode === mode);
      const parts: string[] = [];
      const keep = names("include");
      if (keep.length) parts.push("keep " + keep.map((p) => p.field).join(", "));
      const drop = names("exclude");
      if (drop.length) parts.push("drop " + drop.map((p) => p.field).join(", "));
      const ren = names("rename");
      if (ren.length) parts.push("rename " + ren.map((p) => `${p.value ?? ""}→${p.field}`).join(", "));
      const exp = names("expr");
      if (exp.length) parts.push("compute " + exp.map((p) => p.field).join(", "));
      return parts.join(" · ");
    },
  };
}

export const projectCodec = makeCodec(true);
export const addFieldsCodec = makeCodec(false);
