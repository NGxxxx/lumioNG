import type { Environment } from "./environment";

export type DestructiveOp =
  | "deleteOne" | "deleteMany" | "updateMany" | "dropCollection"
  | "truncate" | "dropIndex" | "dropDatabase" | "script" | "killOp" | "setValidator" | "sync" | "searchIndexWrite"
  | "storePlaintext" | "createDataKey";

/** How much friction an operation needs before it runs (spec §2.1). */
export function confirmLevel(env: Environment, op: DestructiveOp, count: number | null): "none" | "confirm" | "type" {
  switch (op) {
    case "deleteOne":
    case "script":
      return "confirm";
    case "setValidator": // only PROD asks
    case "searchIndexWrite": // create / update of a search index: only PROD asks
    case "createDataKey": // additive: only PROD asks
      return env === "prod" ? "confirm" : "none";
    case "deleteMany":
    case "updateMany":
      return env === "prod" || count === null ? "type" : "confirm";
    case "killOp":
    case "sync":
    case "storePlaintext": // writing an encrypted field's value unencrypted: PROD asks for the collection name
      return env === "prod" ? "type" : "confirm";
    default:
      return "type"; // drops / truncate
  }
}

/** Whether "Don't ask again" may apply; PROD scripts always confirm. */
export function canSuppress(env: Environment, op: DestructiveOp): boolean {
  return !(env === "prod" && op === "script");
}

/** Dialog content as message keys (the component translates them). */
export function describeDestructive(
  op: DestructiveOp,
  target: { db: string; coll?: string; index?: string; colls?: string[]; opid?: string },
  count: number | null,
  level: "none" | "confirm" | "type",
  undoable: boolean,
): { titleKey: string; countText: string | null; irreversible: boolean; expectedName: string | null; actionKey: string; count: number | null } {
  const many = (target.colls?.length ?? 0) > 1 && (op === "dropCollection" || op === "truncate");
  let expectedName: string | null = null;
  if (level === "type") {
    expectedName =
      op === "dropDatabase" || many ? target.db
      : op === "dropIndex" ? (target.index ?? null)
      : op === "killOp" ? (target.opid ?? null)
      : (target.coll ?? null);
  }
  return {
    titleKey: many ? (op === "dropCollection" ? "destructive_title_dropCollections" : "destructive_title_truncateMany") : `destructive_title_${op}`,
    actionKey: `destructive_action_${op}`,
    countText: count === null ? null : count.toLocaleString("en-US"),
    irreversible: !undoable,
    expectedName,
    count,
  };
}
