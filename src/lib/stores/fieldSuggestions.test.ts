import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  sampleDocuments: vi.fn(),
}));

import { sampleDocuments } from "../api/documents";
import { fieldsFor, disposeFieldSuggestions } from "./fieldSuggestions";

const sample = sampleDocuments as ReturnType<typeof vi.fn>;

describe("fieldsFor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("samples once and infers field paths", async () => {
    sample.mockResolvedValueOnce([{ _id: { $oid: "1" }, name: "A", age: 30 }]);
    const fields = await fieldsFor("s1", "mydb", "mycoll");
    expect(sample).toHaveBeenCalledWith("s1", "mydb", "mycoll", "{}", 50, expect.any(Number));
    expect(fields).toEqual(expect.arrayContaining(["name", "age"]));
    disposeFieldSuggestions("s1");
  });

  it("caches per (sessionId, db, coll): repeated calls do not re-sample", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    await fieldsFor("s2", "mydb", "mycoll");
    await fieldsFor("s2", "mydb", "mycoll");
    expect(sample).toHaveBeenCalledTimes(1);
    disposeFieldSuggestions("s2");
  });

  it("de-dupes concurrent calls for the same key", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    await Promise.all([fieldsFor("s3", "mydb", "mycoll"), fieldsFor("s3", "mydb", "mycoll")]);
    expect(sample).toHaveBeenCalledTimes(1);
    disposeFieldSuggestions("s3");
  });

  it("returns [] when sampling fails", async () => {
    sample.mockRejectedValueOnce(new Error("boom"));
    expect(await fieldsFor("s4", "mydb", "mycoll")).toEqual([]);
    disposeFieldSuggestions("s4");
  });

  it("two different sessions on the same db/coll each get their own cache entry", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "1" }, a: 1 }]);
    await fieldsFor("s5", "mydb", "mycoll");
    await fieldsFor("s6", "mydb", "mycoll");
    expect(sample).toHaveBeenCalledTimes(2);
    disposeFieldSuggestions("s5");
    disposeFieldSuggestions("s6");
  });

  it("disposeFieldSuggestions only clears entries for the given session", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "1" }, a: 1 }]);
    await fieldsFor("s7", "mydb", "mycoll");
    await fieldsFor("s8", "mydb", "mycoll");
    disposeFieldSuggestions("s7");
    sample.mockClear();
    await fieldsFor("s7", "mydb", "mycoll"); // re-samples: was cleared
    await fieldsFor("s8", "mydb", "mycoll"); // still cached: not cleared
    expect(sample).toHaveBeenCalledTimes(1);
    disposeFieldSuggestions("s7");
    disposeFieldSuggestions("s8");
  });

  it("does not resurrect a cache entry when disposed while sampling is still in flight", async () => {
    let resolveSample!: (docs: unknown[]) => void;
    sample.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSample = resolve;
      }),
    );
    const pending = fieldsFor("s9", "mydb", "mycoll");
    disposeFieldSuggestions("s9"); // dispose while sampleDocuments is still unresolved
    resolveSample([{ _id: { $oid: "1" }, a: 1 }]);
    await pending;

    sample.mockClear();
    sample.mockResolvedValueOnce([{ _id: { $oid: "1" }, b: 2 }]);
    const fields = await fieldsFor("s9", "mydb", "mycoll");
    expect(sample).toHaveBeenCalledTimes(1); // re-sampled: no stale cache entry left behind
    expect(fields).toEqual(expect.arrayContaining(["b"]));
    disposeFieldSuggestions("s9");
  });

  it("a disposed call's finally does not delete a newer call's in-flight entry for the same key", async () => {
    let resolveFirst!: (docs: unknown[]) => void;
    sample.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const firstCall = fieldsFor("s10", "mydb", "mycoll"); // registers A's promise in `inflight`
    disposeFieldSuggestions("s10"); // A's `inflight` entry is now gone (but A itself hasn't resolved yet)

    let resolveSecond!: (docs: unknown[]) => void;
    sample.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    const secondCall = fieldsFor("s10", "mydb", "mycoll"); // B registers its OWN promise at the same key

    resolveFirst([{ _id: { $oid: "1" }, a: 1 }]); // A resolves late; its `finally` must not touch B's entry
    await firstCall;

    const thirdCall = fieldsFor("s10", "mydb", "mycoll"); // must de-dupe against B, not re-sample
    resolveSecond([{ _id: { $oid: "1" }, b: 2 }]);
    await Promise.all([secondCall, thirdCall]);

    expect(sample).toHaveBeenCalledTimes(2); // one for A, one for B — third call de-duped against B
    disposeFieldSuggestions("s10");
  });
});
