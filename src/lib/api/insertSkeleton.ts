import { sampleDocuments } from "./documents";
import { inferSchema } from "../domain/schema";
import { buildSkeleton } from "../domain/skeleton";
import type { Doc } from "../domain/doc";

/** Sample a collection and turn its inferred schema into an empty "New document" skeleton, so the
 *  insert form pre-fills every known field and the user only fills in values. Returns `null` when
 *  sampling fails, letting callers fall back to a blank form.
 *
 *  Lives in `api/` (not `domain/`) because it composes the `sample_documents` command with the two
 *  pure helpers — `domain/` must never import upward into `api/`. */
export async function buildInsertSkeleton(
  sessionId: string,
  db: string,
  coll: string,
  filter = "{}",
  size = 100,
  timeoutMs: number | null = null,
): Promise<Doc | null> {
  try {
    const sample = await sampleDocuments(sessionId, db, coll, filter, size, timeoutMs);
    return buildSkeleton(inferSchema(sample).fields);
  } catch {
    return null;
  }
}
