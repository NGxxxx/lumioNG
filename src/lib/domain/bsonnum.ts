/** Validate and build ExtJSON values for BSON numeric types (shared by inline-edit and tree). */
import type { RebuildResult } from "./celledit";

/** BSON numeric kinds that share validation rules across inline-edit and the tree. */
export type NumericKind = "int" | "long" | "double" | "decimal";

/**
 * Validate and build an ExtJSON value for a BSON numeric kind from raw text.
 * Shared error keys and behavior match celledit and bsontree:
 * - int: 32-bit integer
 * - long: integer within 64-bit range (BigInt)
 * - double: Number.isFinite
 * - decimal: pattern -?\d+(\.\d+)?
 */
export function rebuildNumber(kind: NumericKind, t: string): RebuildResult {
  switch (kind) {
    case "int": {
      const n = Number(t);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
        return { ok: false, error: "err_number_int32" };
      return { ok: true, value: { $numberInt: String(n) } };
    }
    case "long": {
      if (!/^-?\d+$/.test(t)) return { ok: false, error: "err_number_integer" };
      const big = BigInt(t);
      if (big < -9223372036854775808n || big > 9223372036854775807n)
        return { ok: false, error: "err_number_int64_overflow" };
      return { ok: true, value: { $numberLong: t } };
    }
    case "double": {
      const n = Number(t);
      if (t === "" || !Number.isFinite(n)) return { ok: false, error: "err_number_invalid" };
      return { ok: true, value: { $numberDouble: t } };
    }
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: "err_number_decimal_invalid" };
      return { ok: true, value: { $numberDecimal: t } };
  }
}
