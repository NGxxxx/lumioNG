// src/lib/stores/destructiveCounts.ts — counts shown before dropping / truncating (feeds destructiveGate).
import { collStats, dbStats } from "../api/stats";
import { parseCollStats, parseDbStats } from "../domain/stats";
import type { CountResult } from "./destructiveGate.svelte";

/** Documents + data size of one collection; throws when the server gives no count. */
export async function countCollection(sessionId: string, db: string, coll: string): Promise<CountResult> {
  const s = parseCollStats(await collStats(sessionId, db, coll));
  if (s.count === null) throw new Error("no count");
  return { count: s.count, bytes: s.size };
}

/** Documents + collections of one database. */
export async function countDatabase(sessionId: string, db: string): Promise<CountResult> {
  const s = parseDbStats(await dbStats(sessionId, db));
  if (s.objects === null) throw new Error("no count");
  return { count: s.objects, collections: s.collections };
}
