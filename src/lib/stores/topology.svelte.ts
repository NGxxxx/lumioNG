import { isMaster, replSetStatus, listShards, balancerStatus } from "../api/mongoServer";
import {
  detectTopologyKind,
  parseReplSetStatus,
  parseShardList,
  parseBalancerStatus,
  type TopologyInfo,
} from "../domain/topology";
import { errorMessage } from "../api/errors";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** Loads + holds the curated replica-set/sharding topology for the Host tab's "Topology" sub-tab. */
export function createTopologyStatus(sessionId: string) {
  let info = $state<TopologyInfo | null>(null);
  const guard = createAsyncGuard();

  async function load() {
    const gen = guard.begin();
    try {
      const kind = detectTopologyKind(await isMaster(sessionId));
      if (!guard.isCurrent(gen)) return;
      if (kind === "replicaSet") {
        const rs = parseReplSetStatus(await replSetStatus(sessionId));
        if (!guard.isCurrent(gen)) return;
        info = { kind: "replicaSet", setName: rs.setName, members: rs.members };
      } else if (kind === "mongos") {
        const [shardsResult, balancerResult] = await Promise.allSettled([
          listShards(sessionId),
          balancerStatus(sessionId),
        ]);
        if (!guard.isCurrent(gen)) return;
        // Shards are the whole point of this view for a mongos connection — a failure here is a
        // real error, not something to soft-fail into an empty list. Balancer status is a nice-to-have.
        if (shardsResult.status === "rejected") throw shardsResult.reason;
        const shards = parseShardList(shardsResult.value);
        const balancer = balancerResult.status === "fulfilled" ? parseBalancerStatus(balancerResult.value) : null;
        info = { kind: "mongos", shards, balancer };
      } else {
        info = { kind: "standalone" };
      }
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      info = null;
      guard.setError(errorMessage(e));
    } finally {
      guard.finish(gen);
    }
  }

  return {
    get info() { return info; },
    get error() { return guard.error; },
    get loading() { return guard.loading; },
    load,
  };
}
