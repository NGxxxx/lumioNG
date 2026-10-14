import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/mongoServer", () => ({ currentOps: vi.fn(), killOp: vi.fn() }));

import * as api from "../api/mongoServer";
import { createCurrentOps } from "./currentOps.svelte";

const currentOps = api.currentOps as ReturnType<typeof vi.fn>;
const killOp = api.killOp as ReturnType<typeof vi.fn>;

describe("createCurrentOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("load populates ops from the curated response", async () => {
    currentOps.mockResolvedValue(JSON.stringify({
      inprog: [{ opid: { $numberInt: "1" }, secs_running: { $numberInt: "5" }, op: "query", ns: "d.c" }],
    }));
    const v = createCurrentOps("conn:1");
    await v.load();
    expect(currentOps).toHaveBeenCalledWith("conn:1");
    expect(v.ops).toHaveLength(1);
    expect(v.ops[0].opid).toBe(1);
    expect(v.error).toBeNull();
  });

  it("load surfaces the error message on failure", async () => {
    currentOps.mockRejectedValue({ kind: "Query", message: "not authorized" });
    const v = createCurrentOps("conn:1");
    await v.load();
    expect(v.ops).toEqual([]);
    expect(v.error).toContain("not authorized");
  });

  it("kill calls killOp then reloads the list", async () => {
    currentOps.mockResolvedValue(JSON.stringify({ inprog: [] }));
    killOp.mockResolvedValue(undefined);
    const v = createCurrentOps("conn:1");
    await v.kill(42);
    expect(killOp).toHaveBeenCalledWith("conn:1", 42);
    expect(currentOps).toHaveBeenCalledTimes(1); // the reload triggered by kill()
    expect(v.killing).toBeNull();
  });

  it("kill surfaces the error message when killOp rejects and does not reload", async () => {
    killOp.mockRejectedValue({ kind: "Query", message: "not authorized" });
    const v = createCurrentOps("conn:1");
    await v.kill(42);
    expect(currentOps).not.toHaveBeenCalled();
    expect(v.error).toContain("not authorized");
    expect(v.killing).toBeNull();
  });
});
