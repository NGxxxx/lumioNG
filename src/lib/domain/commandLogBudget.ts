/** Memory budget for the command log: recent commands keep their full text; once the total grows past
 *  the budget, the oldest entries are cut down to a preview. */

export interface BudgetEntry {
  text: string;
  /** Length of the full command, whether or not `text` still holds all of it. */
  length: number;
  clipped: boolean;
}

/** The first `preview` characters of `text` (the entry then counts as clipped). */
export function clipText(text: string, preview: number): string {
  return text.length > preview ? text.slice(0, preview) : text;
}

/** Clips the oldest unclipped entries until the kept text fits `budget` characters. Never mutates;
 *  untouched entries keep their identity. */
export function enforceBudget<T extends BudgetEntry>(entries: readonly T[], budget: number, preview: number): T[] {
  let total = 0;
  for (const e of entries) total += e.text.length;
  if (total <= budget) return entries as T[];
  const out = [...entries];
  for (let i = 0; i < out.length && total > budget; i++) {
    const e = out[i];
    if (e.text.length <= preview) continue;
    const text = clipText(e.text, preview);
    total -= e.text.length - text.length;
    out[i] = { ...e, text, clipped: true };
  }
  return out;
}
