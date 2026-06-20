import type { RebuildResult } from "./celledit";

/** Kiểu số BSON có luật validate riêng (dùng chung cho inline-edit và tree). */
export type NumericKind = "int" | "long" | "double" | "decimal";

/**
 * Validate + dựng giá trị ExtJSON cho một kiểu số BSON từ text (đã được caller
 * truyền vào nguyên trạng). Giữ nguyên chuỗi lỗi/hành vi của celledit + bsontree.
 * - int: số nguyên 32-bit
 * - long: số nguyên trong dải 64-bit (BigInt)
 * - double: Number.isFinite
 * - decimal: dạng thập phân -?\d+(\.\d+)?
 */
export function rebuildNumber(kind: NumericKind, t: string): RebuildResult {
  switch (kind) {
    case "int": {
      const n = Number(t);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
        return { ok: false, error: "Cần số nguyên 32-bit." };
      return { ok: true, value: { $numberInt: String(n) } };
    }
    case "long": {
      if (!/^-?\d+$/.test(t)) return { ok: false, error: "Cần số nguyên." };
      const big = BigInt(t);
      if (big < -9223372036854775808n || big > 9223372036854775807n)
        return { ok: false, error: "Số vượt quá dải 64-bit." };
      return { ok: true, value: { $numberLong: t } };
    }
    case "double": {
      const n = Number(t);
      if (t === "" || !Number.isFinite(n)) return { ok: false, error: "Số không hợp lệ." };
      return { ok: true, value: { $numberDouble: t } };
    }
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Số thập phân không hợp lệ." };
      return { ok: true, value: { $numberDecimal: t } };
  }
}
