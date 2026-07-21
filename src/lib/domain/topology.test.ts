import { describe, it, expect } from "vitest";
import { detectTopologyKind, parseReplSetStatus, parseShardList, parseBalancerStatus } from "./topology";

describe("detectTopologyKind", () => {
  it("standalone: no setName, no isdbgrid msg", () => {
    expect(detectTopologyKind(JSON.stringify({ ismaster: true, maxWireVersion: 21 }))).toBe("standalone");
  });

  it("replicaSet: setName present", () => {
    expect(detectTopologyKind(JSON.stringify({ setName: "rs0", ismaster: true }))).toBe("replicaSet");
  });

  it("mongos: msg is isdbgrid", () => {
    expect(detectTopologyKind(JSON.stringify({ msg: "isdbgrid", ismaster: true }))).toBe("mongos");
  });
});

describe("parseReplSetStatus", () => {
  it("curates members with self flag, health, uptime, optime, pingMs", () => {
    const json = JSON.stringify({
      set: "rs0",
      members: [
        {
          name: "host1:27017",
          health: { $numberDouble: "1" },
          stateStr: "PRIMARY",
          uptime: { $numberInt: "500" },
          optimeDate: { $date: { $numberLong: "1700000000000" } },
          self: true,
        },
        {
          name: "host2:27017",
          health: { $numberDouble: "1" },
          stateStr: "SECONDARY",
          uptime: { $numberInt: "480" },
          optimeDate: { $date: { $numberLong: "1700000000000" } },
          pingMs: { $numberLong: "2" },
        },
      ],
    });
    const r = parseReplSetStatus(json);
    expect(r.setName).toBe("rs0");
    expect(r.members).toHaveLength(2);
    expect(r.members[0]).toEqual({
      name: "host1:27017", stateStr: "PRIMARY", health: 1, uptime: 500,
      optimeDate: "2023-11-14T22:13:20.000Z", pingMs: null, self: true,
    });
    expect(r.members[1].pingMs).toBe(2);
    expect(r.members[1].self).toBe(false);
  });

  it("missing members array degrades to an empty list, not a throw", () => {
    const r = parseReplSetStatus(JSON.stringify({ set: "rs0" }));
    expect(r.members).toEqual([]);
  });
});

describe("parseShardList", () => {
  it("curates shard id/host/draining", () => {
    const json = JSON.stringify({
      shards: [
        { _id: "shard0000", host: "shard0000/h1:27018,h2:27018" },
        { _id: "shard0001", host: "shard0001/h3:27018", draining: true },
      ],
    });
    const shards = parseShardList(json);
    expect(shards).toEqual([
      { id: "shard0000", host: "shard0000/h1:27018,h2:27018", draining: false },
      { id: "shard0001", host: "shard0001/h3:27018", draining: true },
    ]);
  });

  it("missing shards array degrades to an empty list", () => {
    expect(parseShardList(JSON.stringify({}))).toEqual([]);
  });
});

describe("parseBalancerStatus", () => {
  it("curates mode and inBalancerRound", () => {
    const b = parseBalancerStatus(JSON.stringify({
      mode: "full", inBalancerRound: false, numBalancerRounds: { $numberLong: "12" },
    }));
    expect(b).toEqual({ mode: "full", inBalancerRound: false });
  });

  it("missing fields degrade to null", () => {
    expect(parseBalancerStatus(JSON.stringify({}))).toEqual({ mode: null, inBalancerRound: null });
  });
});
