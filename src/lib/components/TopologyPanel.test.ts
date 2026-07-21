import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { TopologyInfo } from "../domain/topology";

let mockInfo: TopologyInfo | null = null;
const load = vi.fn();

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { get active() { return { id: "conn:1" }; } },
}));

vi.mock("../stores/topology.svelte", () => ({
  createTopologyStatus: () => ({
    get info() { return mockInfo; },
    get loading() { return false; },
    get error() { return null; },
    load,
  }),
}));

import TopologyPanel from "./TopologyPanel.svelte";

describe("TopologyPanel", () => {
  it("loads on mount", () => {
    mockInfo = { kind: "standalone" };
    render(TopologyPanel);
    expect(load).toHaveBeenCalled();
  });

  it("standalone shows a plain notice, no table", () => {
    mockInfo = { kind: "standalone" };
    const { getByText, queryByRole } = render(TopologyPanel);
    expect(getByText("Standalone server (not part of a replica set or sharded cluster).")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
  });

  it("replica set renders the set name and one row per member, primary marked", () => {
    mockInfo = {
      kind: "replicaSet",
      setName: "rs0",
      members: [
        { name: "h1:27017", stateStr: "PRIMARY", health: 1, uptime: 500, optimeDate: "2026-07-21T10:30:45.123Z", pingMs: null, self: true },
        { name: "h2:27017", stateStr: "SECONDARY", health: 1, uptime: 480, optimeDate: null, pingMs: 2, self: false },
      ],
    };
    const { getByText, getAllByText } = render(TopologyPanel);
    expect(getByText("Replica set: rs0")).toBeTruthy();
    expect(getByText("PRIMARY")).toBeTruthy();
    expect(getByText("SECONDARY")).toBeTruthy();
    expect(getAllByText("you")).toHaveLength(1);
    expect(getByText("2026-07-21T10:30:45.123Z")).toBeTruthy();
  });

  it("mongos renders shard rows and the balancer mode", () => {
    mockInfo = {
      kind: "mongos",
      shards: [{ id: "shard0000", host: "h1:27018", draining: false }],
      balancer: { mode: "full", inBalancerRound: false },
    };
    const { getByText } = render(TopologyPanel);
    expect(getByText("shard0000")).toBeTruthy();
    expect(getByText("h1:27018")).toBeTruthy();
    expect(getByText("Balancer: full")).toBeTruthy();
  });

  it("mongos with no balancer info (soft-failed) shows the unavailable notice instead of throwing", () => {
    mockInfo = { kind: "mongos", shards: [], balancer: null };
    const { getByText } = render(TopologyPanel);
    expect(getByText("Balancer status unavailable.")).toBeTruthy();
  });
});
