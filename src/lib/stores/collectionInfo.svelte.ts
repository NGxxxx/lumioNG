import { collStats, collOptions } from "../api/stats";
import { setCollectionValidator } from "../api/admin";
import {
  parseCollStats,
  parseCollOptions,
  type CollStatsInfo,
  type CollOptionsInfo,
} from "../domain/stats";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { collStatsCmd, setValidatorCmd } from "../domain/mongosh";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** State and loader for the collection Info tab. Components only render. */
export function createCollectionInfo(sessionId: string, db: string, coll: string) {
  let stats = $state<CollStatsInfo | null>(null);
  let options = $state<CollOptionsInfo | null>(null);
  let validatorSaving = $state(false);
  let validatorError = $state<string | null>(null);
  const guard = createAsyncGuard();

  /** `validatorJson: "{}"` clears the validator. Reloads options on success so the read-only view reflects it immediately. */
  async function saveValidator(validatorJson: string, validationLevel: string, validationAction: string) {
    validatorSaving = true;
    validatorError = null;
    try {
      await commandLog.pushTimed(
        setValidatorCmd(coll, validatorJson, validationLevel, validationAction),
        sessionId,
        () => setCollectionValidator(sessionId, db, coll, validatorJson, validationLevel, validationAction),
      );
      await refresh();
      return true;
    } catch (e) {
      validatorError = errorMessage(e);
      return false;
    } finally {
      validatorSaving = false;
    }
  }

  async function refresh() {
    const gen = guard.begin();
    try {
      const [s, o] = await commandLog.pushTimed(collStatsCmd(coll), sessionId, () =>
        Promise.all([collStats(sessionId, db, coll), collOptions(sessionId, db, coll)]));
      if (!guard.isCurrent(gen)) return;
      stats = parseCollStats(s);
      options = parseCollOptions(o);
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      guard.setError(errorMessage(e));
    } finally {
      guard.finish(gen);
    }
  }

  return {
    get stats() {
      return stats;
    },
    get options() {
      return options;
    },
    get error() {
      return guard.error;
    },
    get loading() {
      return guard.loading;
    },
    get validatorSaving() {
      return validatorSaving;
    },
    get validatorError() {
      return validatorError;
    },
    init: refresh,
    refresh,
    saveValidator,
  };
}
