import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { HostInfo } from "../domain/host";
import { createSessionNav } from "../stores/navigation.svelte";

let mockInfo: HostInfo | null = null;
const nav = createSessionNav();

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: {
    get active() {
      return {
        id: "conn:1",
        readOnly: false,
        host: {
          get info() { return mockInfo; },
          get error() { return null; },
          get loading() { return false; },
        },
        nav,
      };
    },
    get sessions() { return []; },
  },
}));

vi.mock("../stores/currentOps.svelte", () => ({
  createCurrentOps: () => ({
    ops: [],
    loading: false,
    error: null,
    killing: null,
    load: vi.fn(),
    kill: vi.fn(),
  }),
}));

vi.mock("../stores/topology.svelte", () => ({
  createTopologyStatus: () => ({
    info: { kind: "standalone" as const },
    loading: false,
    error: null,
    load: vi.fn(),
  }),
}));

vi.mock("../stores/usersRoles.svelte", () => ({
  createUsersRolesView: () => ({
    users: [],
    usersError: null,
    usersLoading: false,
    roles: [],
    rolesError: null,
    rolesLoading: false,
    rolesDb: "admin",
    init: vi.fn(),
    loadUsers: vi.fn(),
    loadRoles: vi.fn(),
    createUser: vi.fn(),
    updateUserRoles: vi.fn(),
    changeUserPassword: vi.fn(),
    dropUser: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    dropRole: vi.fn(),
  }),
}));

import HostTab from "./HostTab.svelte";

describe("HostTab", () => {
  beforeEach(() => {
    nav.setHostSection("info");
  });

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

  it("defaults to Info; clicking Current Operations switches the sub-pane", async () => {
    mockInfo = null;
    const { getByText, queryByText } = render(HostTab, { props: { connection: { label: "local", uri: "mongodb://h" } } });
    expect(queryByText("No active operations.")).toBeNull();
    await fireEvent.click(getByText("Current Operations"));
    expect(getByText("No active operations.")).toBeTruthy();
  });

  it("Users and Roles are flat host subtabs switching the sub-pane", async () => {
    mockInfo = null;
    const { getByText, getByRole } = render(HostTab, { props: { connection: { label: "local", uri: "mongodb://h" } } });
    await fireEvent.click(getByRole("button", { name: "Users" }));
    expect(getByText("＋ Create user")).toBeTruthy();
    // Scoped to role="button": UserList's "Roles" table column header is also on screen.
    await fireEvent.click(getByRole("button", { name: "Roles" }));
    expect(getByText("＋ Create role")).toBeTruthy();
  });

  it("clicking Topology switches the sub-pane", async () => {
    mockInfo = null;
    const { getByText, getByRole } = render(HostTab, { props: { connection: { label: "local", uri: "mongodb://h" } } });
    await fireEvent.click(getByRole("button", { name: "Topology" }));
    expect(getByText("Standalone server (not part of a replica set or sharded cluster).")).toBeTruthy();
  });
});
