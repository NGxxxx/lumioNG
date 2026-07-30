import { createPipelineTree, type PipelineTree, type ScriptBinding } from "./pipelineTree.svelte";

// Plain Map (NOT $state): each store already owns its runes state; wrapping the Map in $state
// would double-proxy those stores. Mirrors stores/queryRuns.svelte.ts.
const trees = new Map<number, PipelineTree>();

/** Get (creating + caching on first call) the Pipeline Tree store for a Query tab id. */
export function getPipelineTree(id: number, sessionId: string, script: ScriptBinding): PipelineTree {
  let t = trees.get(id);
  if (!t) {
    t = createPipelineTree(sessionId, script);
    trees.set(id, t);
  }
  return t;
}

/** Drop a query tab's Pipeline Tree store (call when the tab closes). No-op for unknown ids. */
export function disposePipelineTree(id: number): void {
  trees.delete(id);
}
