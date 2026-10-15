// src/lib/components/chipOpLabel.ts — localized operator label for a filter chip (rendering helper).
import type { ChipOp } from "../domain/filterChips";
import type { ChipValueType } from "../domain/fieldInfo";
import * as m from "#lib/paraglide/messages.js";

const LABELS: Record<ChipOp, () => string> = {
  eq: m.chip_op_eq, ne: m.chip_op_ne, contains: m.chip_op_contains, startsWith: m.chip_op_startsWith,
  in: m.chip_op_in, exists: m.chip_op_exists, notExists: m.chip_op_notExists, gt: m.chip_op_gt,
  gte: m.chip_op_gte, lt: m.chip_op_lt, lte: m.chip_op_lte, between: m.chip_op_between,
  lastDays: m.chip_op_lastDays, before: m.chip_op_before, after: m.chip_op_after, today: m.chip_op_today,
  elemMatch: m.chip_op_elemMatch, size: m.chip_op_size, isTrue: m.chip_op_isTrue, isFalse: m.chip_op_isFalse,
};

/** "is" / "is not" read better than "=" / "≠" for text-like values. */
export function chipOpLabel(op: ChipOp, type: ChipValueType): string {
  const wordy = type === "string" || type === "objectId" || type === "unknown";
  if (wordy && op === "eq") return m.chip_op_is();
  if (wordy && op === "ne") return m.chip_op_isnot();
  return LABELS[op]();
}
