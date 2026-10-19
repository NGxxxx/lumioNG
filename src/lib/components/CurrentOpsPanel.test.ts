import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { OpInfo } from "../domain/host";

let mockOps: OpInfo[] = [];
let mockReadOnly = false;
const kill = vi.fn();
const load = vi.fn();

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: {
    get active() {
      return { id: "conn:1", get readOnly() { return mockReadOnly; } };
    },
  },
}));

vi.mock("../stores/currentOps.svelte", () => ({
  createCurrentOps: () => ({
    get ops() { return mockOps; },
    get loading() { return false; },
    get error() { return null; },
    get killing() { return null; },
    load,
    kill,
  }),
}));

import CurrentOpsPanel from "./CurrentOpsPanel.svelte";

describe("CurrentOpsPanel", () => {
  it("loads on mount and renders one row per op", () => {
    mockOps = [{ opid: 7, secsRunning: 12, op: "query", ns: "d.c", client: "1.2.3.4:5", desc: null, appName: "LumioNG" }];
    const { getByText } = render(CurrentOpsPanel);
    expect(load).toHaveBeenCalled();
    expect(getByText("7")).toBeTruthy();
    expect(getByText("d.c")).toBeTruthy();
  });

  it("shows the empty state when there are no ops", () => {
    mockOps = [];
    const { getByText } = render(CurrentOpsPanel);
    expect(getByText("No active operations.")).toBeTruthy();
  });

  it("asks for confirmation before killing, and only calls kill on confirm", async () => {
    mockOps = [{ opid: 7, secsRunning: 12, op: "query", ns: "d.c", client: "1.2.3.4:5", desc: null, appName: "LumioNG" }];
    const { getByText, queryByText } = render(CurrentOpsPanel);
    await fireEvent.click(getByText("Kill"));
    expect(getByText("Kill operation?")).toBeTruthy();
    expect(kill).not.toHaveBeenCalled();
    await fireEvent.click(getByText("Kill operation?").closest(".modal")!.querySelector(".danger")!);
    expect(kill).toHaveBeenCalledWith(7);
    expect(queryByText("Kill operation?")).toBeNull();
  });

  it("disables the Kill button on a read-only session", () => {
    mockReadOnly = true;
    mockOps = [{ opid: 7, secsRunning: 12, op: "query", ns: "d.c", client: "1.2.3.4:5", desc: null, appName: "LumioNG" }];
    const { getByText } = render(CurrentOpsPanel);
    expect((getByText("Kill") as HTMLButtonElement).disabled).toBe(true);
    mockReadOnly = false;
  });

  it("marks LumioNG's own ops with a \"you\" badge but not other clients' ops", () => {
    mockOps = [
      { opid: 7, secsRunning: 12, op: "query", ns: "d.c", client: "1.2.3.4:5", desc: null, appName: "LumioNG" },
      { opid: 8, secsRunning: 3, op: "update", ns: "d.c2", client: "1.2.3.4:6", desc: null, appName: "mongosh 2.1.1" },
    ];
    const { getByText, getAllByText } = render(CurrentOpsPanel);
    expect(getAllByText("you")).toHaveLength(1);
    expect(getByText("mongosh 2.1.1")).toBeTruthy();
  });
});
