import { sampleDocuments } from "../api/documents";
import { inferSchema, type FieldSchema } from "../domain/schema";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { sampleCmd } from "../domain/mongosh";

/** State + loader for the Collection tab's schema-as-table view. */
export function createCollectionSchema(sessionId: string, db: string, coll: string, defaultSize = 100) {
  let fields = $state<FieldSchema[]>([]);
  let sampleSize = $state(defaultSize);
  let actualSampled = $state(0);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    try {
      const docs = await sampleDocuments(sessionId, db, coll, "{}", sampleSize);
      const schema = inferSchema(docs);
      fields = schema.fields;
      actualSampled = schema.sampleSize;
      commandLog.push(sampleCmd(coll, sampleSize), sessionId);
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function setSampleSize(n: number) {
    sampleSize = Math.max(1, Math.floor(n) || 1);
  }

  return {
    get fields() { return fields; },
    get sampleSize() { return sampleSize; },
    get actualSampled() { return actualSampled; },
    get error() { return error; },
    get loading() { return loading; },
    setSampleSize,
    init: refresh,
    refresh,
  };
}
