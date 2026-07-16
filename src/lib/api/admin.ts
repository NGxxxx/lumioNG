import { invoke } from "@tauri-apps/api/core";

export async function createCollection(sessionId: string, db: string, coll: string): Promise<void> {
  await invoke("create_collection", { sessionId, db, coll });
}

export async function dropCollection(sessionId: string, db: string, coll: string): Promise<void> {
  await invoke("drop_collection", { sessionId, db, coll });
}

export async function renameCollection(sessionId: string, db: string, from: string, to: string): Promise<void> {
  await invoke("rename_collection", { sessionId, db, from, to });
}

export async function duplicateCollection(sessionId: string, db: string, source: string, target: string): Promise<void> {
  await invoke("duplicate_collection", { sessionId, db, source, target });
}

export async function dropDatabase(sessionId: string, db: string): Promise<void> {
  await invoke("drop_database", { sessionId, db });
}

export async function truncateCollection(sessionId: string, db: string, coll: string): Promise<number> {
  return await invoke<number>("truncate_collection", { sessionId, db, coll });
}

/** `validatorJson: "{}"` clears the validator. `validationLevel`/`validationAction` use MongoDB's
 *  own vocabulary ("off"/"strict"/"moderate", "error"/"warn"). */
export async function setCollectionValidator(
  sessionId: string,
  db: string,
  coll: string,
  validatorJson: string,
  validationLevel: string,
  validationAction: string,
): Promise<void> {
  await invoke("set_collection_validator", {
    sessionId, db, coll, validatorJson, validationLevel, validationAction,
  });
}
