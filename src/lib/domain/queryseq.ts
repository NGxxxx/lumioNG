/** Smallest positive integer not present in `used` (for Query #N tab labels). */
export function nextQuerySeq(used: number[]): number {
  const set = new Set(used);
  let n = 1;
  while (set.has(n)) n++;
  return n;
}
