import { createIndexesRaw } from "../api/indexes";
import { setCollectionValidator } from "../api/admin";
import { createIndexesCmd, setValidatorCmd } from "../domain/mongosh";
import { parseMetadataBundle } from "../domain/collectionMetadata";
import { commandLog } from "./commandLog.svelte";
import { errorMessage } from "../api/errors";

/** Applies an exported metadata sidecar (indexes + validator) to a just-imported collection.
 *  Returns an error message on failure, or null on success — used after a successful document
 *  import, so a metadata failure never rolls back or hides the (already-succeeded) data import. */
export async function restoreCollectionMetadata(
  sessionId: string,
  db: string,
  coll: string,
  bundleJson: string,
): Promise<string | null> {
  const parsed = parseMetadataBundle(bundleJson);
  if (parsed === null) return null; // malformed/foreign sidecar — nothing to restore, not an error
  try {
    if (parsed.indexesJson !== "[]") {
      await commandLog.pushTimed(createIndexesCmd(coll, parsed.indexesJson), sessionId, () =>
        createIndexesRaw(sessionId, db, coll, parsed.indexesJson));
    }
    if (parsed.validatorJson !== null) {
      await commandLog.pushTimed(
        setValidatorCmd(coll, parsed.validatorJson, parsed.validationLevel, parsed.validationAction),
        sessionId,
        () => setCollectionValidator(sessionId, db, coll, parsed.validatorJson!, parsed.validationLevel, parsed.validationAction),
      );
    }
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}
