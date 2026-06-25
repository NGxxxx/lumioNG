import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { HostInfo } from "../domain/host";

let mockInfo: HostInfo | null = null;

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: {
    get active() {
      return {
        host: {
          get info() { return mockInfo; },
          get error() { return null; },
          get loading() { return false; },
        },
      };
    },
    get sessions() { return []; },
  },
}));

import HostTab from "./HostTab.svelte";

describe("HostTab", () => {
  it("shows connection label and URI", () => {
    mockInfo = null;
    const { getByText } = render(HostTab, { props: { connection: { label: "local MongoDB", uri: "mongodb://localhost:27017" } } });
    expect(getByText("local MongoDB")).toBeTruthy();
    expect(getByText("mongodb://localhost:27017")).toBeTruthy();
  });

  it("renders host info table when mockInfo is set", () => {
    mockInfo = {
      version: "7.0.5",
      storageEngine: "wiredTiger",
      hostname: "db-1",
      os: "Ubuntu 22.04",
      uptimeSeconds: 3725,
      localTimeIso: null,
      connectionsCurrent: 4,
      connectionsAvailable: 1000,
      memResidentMb: 120,
      memVirtualMb: 1500,
      opcounters: { insert: 10, query: 20 },
      network: { bytesIn: 999, bytesOut: 888, numRequests: 7 },
    };
    const { getByText } = render(HostTab, { props: { connection: { label: "local MongoDB", uri: "mongodb://localhost:27017" } } });
    expect(getByText("7.0.5")).toBeTruthy();
    expect(getByText("local MongoDB")).toBeTruthy();
    expect(getByText("mongodb://localhost:27017")).toBeTruthy();
    // opcounter row for "query" should appear
    expect(getByText("query")).toBeTruthy();
  });
});
