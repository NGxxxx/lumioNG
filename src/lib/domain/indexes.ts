export type IndexKeyValue = number | string;

export interface IndexInfo {
  name: string;
  entries: { field: string; value: IndexKeyValue }[]; // GIỮ THỨ TỰ field
  unique: boolean;
  sparse: boolean;
  ttl: number | null; // expireAfterSeconds nếu có
  isId: boolean; // name === "_id_"
}

/** Rút số từ giá trị ExtJSON ($numberInt/$numberLong/$numberDouble/$numberDecimal) hoặc số thô. */
function extJsonNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"]) {
      if (k in o) return Number(o[k]);
    }
  }
  return null;
}

function normalizeKeyValue(v: unknown): IndexKeyValue {
  const n = extJsonNumber(v);
  return n !== null ? n : String(v); // "text" / "2dsphere" / "hashed" ...
}

/** Parse danh sách index doc (Canonical ExtJSON) → IndexInfo[]. */
export function parseIndexList(jsonStrings: string[]): IndexInfo[] {
  return jsonStrings.map((s) => {
    const doc = JSON.parse(s) as Record<string, unknown>;
    const name = String(doc.name ?? "");
    const key = (doc.key ?? {}) as Record<string, unknown>;
    const entries = Object.entries(key).map(([field, value]) => ({
      field,
      value: normalizeKeyValue(value),
    }));
    return {
      name,
      entries,
      unique: doc.unique === true,
      sparse: doc.sparse === true,
      ttl: extJsonNumber(doc.expireAfterSeconds),
      isId: name === "_id_",
    };
  });
}

/** Dựng ExtJSON keys string giữ đúng thứ tự field (không phụ thuộc thứ tự khóa object JS). */
export function buildIndexKeys(fields: { field: string; dir: 1 | -1 }[]): string {
  const parts = fields.map((f) => `${JSON.stringify(f.field.trim())}:${f.dir}`);
  return `{${parts.join(",")}}`;
}

/** Trả message lỗi hoặc null. ≥1 field không rỗng; không trùng field. */
export function validateIndexFields(fields: { field: string; dir: 1 | -1 }[]): string | null {
  const names = fields.map((f) => f.field.trim()).filter((n) => n.length > 0);
  if (names.length === 0) return "Cần ít nhất một field.";
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) return `Field trùng: "${n}".`;
    seen.add(n);
  }
  return null;
}

/** "{ email: 1, age: -1 }" cho hiển thị. */
export function describeKeys(entries: IndexInfo["entries"]): string {
  return `{ ${entries.map((e) => `${e.field}: ${e.value}`).join(", ")} }`;
}
