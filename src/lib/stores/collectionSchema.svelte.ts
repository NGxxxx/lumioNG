import { sampleDocuments } from "../api/documents";
import { inferSchema, type FieldSchema } from "../domain/schema";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";
import * as m from "$lib/paraglide/messages";
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
    activity.begin(m.common_running());
    try {
      const docs = await commandLog.pushTimed(sampleCmd(coll, sampleSize), sessionId, () =>
        sampleDocuments(sessionId, db, coll, "{}", sampleSize, settings.queryTimeoutMs));
      const schema = inferSchema(docs);
      fields = schema.fields;
      actualSampled = schema.sampleSize;
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
      activity.end();
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
