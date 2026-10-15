/** Singular / plural choice for counted UI text (English-style: exactly 1 is singular). */
export function plural(count: number, one: () => string, other: () => string): string {
  return count === 1 ? one() : other();
}
