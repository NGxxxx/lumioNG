import { importDocuments, importBson, type ImportResult } from "../api/documents";
import { importCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { errorMessage } from "../api/errors";
import * as m from "$lib/paraglide/messages";

export interface ImportJobConfig {
  sessionId: string;
  db: string;
  coll: string;
  path: string;
}

/** Drives a single import (JSON/JSONL or BSON) with live done/total progress, for ImportDialog. */
export function createImportJob(config: ImportJobConfig) {
  let done = $state(0);
  let total = $state(0);
  let running = $state(false);
  let finished = $state(false);
  let result = $state<ImportResult | null>(null);
  let error = $state<string | null>(null);

  async function run() {
    if (running || finished) return;
    running = true;
    activity.begin(m.common_running());
    const onProgress = (d: number, t: number) => {
      done = d;
      total = t;
    };
    try {
      const isBson = config.path.toLowerCase().endsWith(".bson");
      result = await commandLog.pushTimed(
        importCmd(config.db, config.coll, config.path),
        config.sessionId,
        () =>
          isBson
            ? importBson(config.sessionId, config.db, config.coll, config.path, onProgress)
            : importDocuments(config.sessionId, config.db, config.coll, config.path, onProgress),
      );
    } catch (e) {
      error = errorMessage(e);
    } finally {
      activity.end();
      running = false;
      finished = true;
    }
  }

  return {
    get done() {
      return done;
    },
    get total() {
      return total;
    },
    get running() {
      return running;
    },
    get finished() {
      return finished;
    },
    get result() {
      return result;
    },
    get error() {
      return error;
    },
    run,
  };
}
