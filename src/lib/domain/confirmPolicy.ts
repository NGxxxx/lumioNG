import type { Environment } from "./environment";

export type DestructiveOp =
  | "deleteOne" | "deleteMany" | "updateMany" | "dropCollection"
  | "truncate" | "dropIndex" | "dropDatabase" | "script";

/** How much friction an operation needs before it runs (spec §2.1). */
export function confirmLevel(env: Environment, op: DestructiveOp, count: number | null): "none" | "confirm" | "type" {
  switch (op) {
    case "deleteOne":
    case "script":
      return "confirm";
    case "deleteMany":
    case "updateMany":
      return env === "prod" || count === null ? "type" : "confirm";
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
  target: { db: string; coll?: string; index?: string },
  count: number | null,
  level: "none" | "confirm" | "type",
  undoable: boolean,
): { titleKey: string; countText: string | null; irreversible: boolean; expectedName: string | null; actionKey: string; count: number | null } {
  let expectedName: string | null = null;
  if (level === "type") {
    expectedName = op === "dropDatabase" ? target.db : op === "dropIndex" ? (target.index ?? null) : (target.coll ?? null);
  }
  return {
    titleKey: `destructive_title_${op}`,
    actionKey: `destructive_action_${op}`,
    countText: count === null ? null : count.toLocaleString("en-US"),
    irreversible: !undoable,
    expectedName,
    count,
  };
}
