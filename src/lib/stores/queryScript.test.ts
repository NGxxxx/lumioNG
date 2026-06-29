import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/script", () => ({
  runScript: vi.fn(async () => ({
    console: [], result: { kind: "ack", json: "{}" },
    provenance: null, capped: false, error: null,
  })),
  cancelScript: vi.fn(),
}));

vi.mock("../api/documents", () => ({
  sampleDocuments: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A", age: 30 }]),
}));

import { runScript, cancelScript } from "../api/script";
import * as docsApi from "../api/documents";
import { createQueryScript } from "./queryScript.svelte";
import { settings } from "./settings.svelte";

const sampleDocuments = docsApi.sampleDocuments as ReturnType<typeof vi.fn>;

const ok = (rows: string[], prov: { db: string; coll: string } | null) => ({
  console: [{ level: "log", text: "hi" }],
  result: { kind: "docs", rows },
  provenance: prov,
  capped: false,
  error: null,
});

describe("destructive confirm", () => {
  beforeEach(() => {
    (runScript as any).mockClear();
    settings.setSuppressDestructiveWarning(false);
  });

  it("destructive script defers run and opens the confirm", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm?.ops).toContain("deleteMany");
  });

  it("confirmRun executes the deferred run", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    await s.confirmRun();
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.destructiveConfirm).toBeNull();
  });

  it("cancelConfirm clears without running", async () => {
    const s = createQueryScript("sess", "db.c.drop()");
    await s.run("mydb");
    s.cancelConfirm();
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm).toBeNull();
  });

  it("suppress flag bypasses the confirm", async () => {
    settings.setSuppressDestructiveWarning(true);
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.destructiveConfirm).toBeNull();
  });

  it("non-destructive script runs immediately", async () => {
    const s = createQueryScript("sess", "db.c.find({})");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledTimes(1);
  });
});

describe("createQueryScript", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates docs + columns + console on a docs result", async () => {
    (runScript as any).mockResolvedValue(ok([`{"_id":1,"a":2}`], { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    expect(s.docs.length).toBe(1);
    expect(s.consoleEntries.length).toBe(1);
    expect(s.displayMode).toBe("grid-editable");
    expect(s.provenance).toEqual({ db: "d", coll: "c" });
  });

  it("surfaces an engine error and clears running", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: "boom",
    });
    const s = createQueryScript("sess", "x");
    await s.run("d");
    expect(s.error).toBe("boom");
    expect(s.running).toBe(false);
  });

  it("requires a database", async () => {
    const s = createQueryScript("sess", "x");
    await s.run(null);
    expect(s.error).toMatch(/database/i);
    expect(runScript).not.toHaveBeenCalled();
  });

  it("cancel() calls cancelScript", () => {
    const s = createQueryScript("sess", "x");
    s.cancel();
    expect(cancelScript).toHaveBeenCalledWith("sess");
  });
});

describe("fieldsFor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("samples once and infers field paths", async () => {
    sampleDocuments.mockResolvedValueOnce([{ _id: { $oid: "1" }, name: "A", age: 30 }]);
    const s = createQueryScript("sess", "x");
    const fields = await s.fieldsFor("mydb", "mycoll");
    expect(sampleDocuments).toHaveBeenCalledWith("sess", "mydb", "mycoll", "{}", 50);
    expect(fields).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("caches per (db, coll): repeated calls do not re-sample", async () => {
    sampleDocuments.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    const s = createQueryScript("sess", "x");
    await s.fieldsFor("mydb", "mycoll");
    await s.fieldsFor("mydb", "mycoll");
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent calls for the same key", async () => {
    sampleDocuments.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    const s = createQueryScript("sess", "x");
    await Promise.all([s.fieldsFor("mydb", "mycoll"), s.fieldsFor("mydb", "mycoll")]);
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("returns [] when sampling fails", async () => {
    sampleDocuments.mockRejectedValueOnce(new Error("boom"));
    const s = createQueryScript("sess", "x");
    expect(await s.fieldsFor("mydb", "mycoll")).toEqual([]);
  });
});

describe("setSelection + hasSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hasSelection is false initially", () => {
    const s = createQueryScript("sess", "db.c.find()");
    expect(s.hasSelection).toBe(false);
  });

  it("hasSelection is true after setSelection covers non-whitespace text", () => {
    const s = createQueryScript("sess", "db.c.find()");
    s.setSelection(0, 5); // "db.c." — non-whitespace
    expect(s.hasSelection).toBe(true);
  });

  it("hasSelection is false when selected range is only whitespace", () => {
    const s = createQueryScript("sess", "   db.c.find()");
    s.setSelection(0, 3); // "   " — pure whitespace
    expect(s.hasSelection).toBe(false);
  });

  it("hasSelection is false when start equals end", () => {
    const s = createQueryScript("sess", "db.c.find()");
    s.setSelection(3, 3);
    expect(s.hasSelection).toBe(false);
  });
});

describe("runSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls runScript with the selected substring when hasSelection is true", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: null,
    });
    const s = createQueryScript("sess", "db.c.find() db.c.count()");
    s.setSelection(0, 11); // "db.c.find()"
    await s.runSelection("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()");
  });

  it("calls runScript with full statementText when no selection", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    // no setSelection → hasSelection is false
    await s.runSelection("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()");
  });
});
