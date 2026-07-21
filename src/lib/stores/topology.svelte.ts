import { isMaster, replSetStatus, listShards, balancerStatus } from "../api/server";
import {
  detectTopologyKind,
  parseReplSetStatus,
  parseShardList,
  parseBalancerStatus,
  type TopologyInfo,
} from "../domain/topology";
import { errorMessage } from "../api/errors";

/** Loads + holds the curated replica-set/sharding topology for the Host tab's "Topology" sub-tab. */
export function createTopologyStatus(sessionId: string) {
  let info = $state<TopologyInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      const kind = detectTopologyKind(await isMaster(sessionId));
      if (kind === "replicaSet") {
        const rs = parseReplSetStatus(await replSetStatus(sessionId));
        info = { kind: "replicaSet", setName: rs.setName, members: rs.members };
      } else if (kind === "mongos") {
        const [shardsResult, balancerResult] = await Promise.allSettled([
          listShards(sessionId),
          balancerStatus(sessionId),
        ]);
        // Shards are the whole point of this view for a mongos connection — a failure here is a
        // real error, not something to soft-fail into an empty list. Balancer status is a nice-to-have.
        if (shardsResult.status === "rejected") throw shardsResult.reason;
        const shards = parseShardList(shardsResult.value);
        const balancer = balancerResult.status === "fulfilled" ? parseBalancerStatus(balancerResult.value) : null;
        info = { kind: "mongos", shards, balancer };
      } else {
        info = { kind: "standalone" };
      }
      error = null;
    } catch (e) {
      info = null;
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  return {
    get info() { return info; },
    get error() { return error; },
    get loading() { return loading; },
    load,
  };
}
