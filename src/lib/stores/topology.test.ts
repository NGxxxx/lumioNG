import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/mongoServer", () => ({
  isMaster: vi.fn(),
  replSetStatus: vi.fn(),
  listShards: vi.fn(),
  balancerStatus: vi.fn(),
}));

import * as api from "../api/mongoServer";
import { createTopologyStatus } from "./topology.svelte";

const isMaster = api.isMaster as ReturnType<typeof vi.fn>;
const replSetStatus = api.replSetStatus as ReturnType<typeof vi.fn>;
const listShards = api.listShards as ReturnType<typeof vi.fn>;
const balancerStatus = api.balancerStatus as ReturnType<typeof vi.fn>;

describe("createTopologyStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("standalone: only calls isMaster", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ ismaster: true }));
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toEqual({ kind: "standalone" });
    expect(replSetStatus).not.toHaveBeenCalled();
    expect(listShards).not.toHaveBeenCalled();
    expect(v.error).toBeNull();
  });

  it("replica set: calls replSetStatus and curates members", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ setName: "rs0", ismaster: true }));
    replSetStatus.mockResolvedValue(JSON.stringify({
      set: "rs0",
      members: [{ name: "h1:27017", stateStr: "PRIMARY", self: true }],
    }));
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toEqual({
      kind: "replicaSet",
      setName: "rs0",
      members: [{ name: "h1:27017", stateStr: "PRIMARY", health: null, uptime: null, optimeDate: null, pingMs: null, self: true }],
    });
    expect(listShards).not.toHaveBeenCalled();
  });

  it("mongos: calls listShards and balancerStatus", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ msg: "isdbgrid", ismaster: true }));
    listShards.mockResolvedValue(JSON.stringify({ shards: [{ _id: "shard0000", host: "h1:27018" }] }));
    balancerStatus.mockResolvedValue(JSON.stringify({ mode: "full", inBalancerRound: false }));
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toEqual({
      kind: "mongos",
      shards: [{ id: "shard0000", host: "h1:27018", draining: false }],
      balancer: { mode: "full", inBalancerRound: false },
    });
    expect(replSetStatus).not.toHaveBeenCalled();
  });

  it("mongos: balancerStatus failure still yields the shard list (soft-fail)", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ msg: "isdbgrid", ismaster: true }));
    listShards.mockResolvedValue(JSON.stringify({ shards: [{ _id: "shard0000", host: "h1:27018" }] }));
    balancerStatus.mockRejectedValue({ kind: "Query", message: "not authorized" });
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toEqual({
      kind: "mongos",
      shards: [{ id: "shard0000", host: "h1:27018", draining: false }],
      balancer: null,
    });
    expect(v.error).toBeNull();
  });

  it("mongos: listShards failure sets error (hard-fail — shards are the whole point of this view)", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ msg: "isdbgrid", ismaster: true }));
    listShards.mockRejectedValue({ kind: "Query", message: "not authorized" });
    balancerStatus.mockResolvedValue(JSON.stringify({ mode: "full", inBalancerRound: false }));
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toBeNull();
    expect(v.error).toContain("not authorized");
  });

  it("isMaster failure sets error and leaves info null", async () => {
    isMaster.mockRejectedValue({ kind: "Query", message: "auth failed" });
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.error).toContain("auth failed");
    expect(v.info).toBeNull();
  });

  it("replSetGetStatus failure sets error (rare, but not silently treated as standalone)", async () => {
    isMaster.mockResolvedValue(JSON.stringify({ setName: "rs0", ismaster: true }));
    replSetStatus.mockRejectedValue({ kind: "Query", message: "not authorized" });
    const v = createTopologyStatus("conn:1");
    await v.load();
    expect(v.info).toBeNull();
    expect(v.error).toContain("not authorized");
  });
});
