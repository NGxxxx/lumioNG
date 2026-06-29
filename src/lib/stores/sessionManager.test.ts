import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api/connection", () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  listNamespaces: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/server", () => ({
  serverStatus: vi.fn().mockResolvedValue("{}"),
  buildInfo: vi.fn().mockResolvedValue("{}"),
  hostInfo: vi.fn().mockResolvedValue("{}"),
}));
import { createSessionManager } from "./sessionManager.svelte";
import { SESSION_COLORS } from "../domain/session";
import { connect } from "../api/connection";

describe("sessionManager", () => {
  let sm: ReturnType<typeof createSessionManager>;
  beforeEach(() => { sm = createSessionManager(); });

  it("opens a session and makes it active", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
    expect(sm.sessions.length).toBe(1);
    expect(sm.activeId).toBe("conn:1");
    expect(sm.active?.label).toBe("local");
  });

  it("focuses instead of duplicating a saved connection", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
    await sm.focusOrOpen({ connId: 2, uri: "mongodb://h2", label: "two" });
    await sm.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
    expect(sm.sessions.length).toBe(2);
    expect(sm.activeId).toBe("conn:1");
  });

  it("tags work tabs with the active session and switches active on activate", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
    sm.openQuery("");
    const t1 = sm.workTabs.at(-1)!;
    expect(t1.sessionId).toBe("conn:1");
    await sm.focusOrOpen({ connId: 2, uri: "u2", label: "b" });
    sm.openQuery("");
    expect(sm.activeId).toBe("conn:2");
    sm.activateWork(t1.id);
    expect(sm.activeId).toBe("conn:1");
  });

  it("closing a session drops its tabs", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
    sm.openQuery("");
    await sm.closeSession("conn:1");
    expect(sm.sessions.length).toBe(0);
    expect(sm.workTabs.length).toBe(0);
    expect(sm.activeId).toBeNull();
  });

  it("two sessions render two roots with distinct palette colors (Task 5: multi-root sidebar)", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
    await sm.focusOrOpen({ connId: 2, uri: "u2", label: "b" });
    expect(sm.sessions.map((s) => s.color)).toEqual([SESSION_COLORS[0], SESSION_COLORS[1]]);
  });

  it("marks a session errored when connect fails, keeps it open", async () => {
    (connect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await sm.focusOrOpen({ connId: 1, uri: "u", label: "a" });
    expect(sm.active?.status).toBe("error");
    expect(sm.sessions.length).toBe(1);
  });

  it("reconnect re-runs connect with the same id", async () => {
    (connect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await sm.focusOrOpen({ connId: 1, uri: "u", label: "a" });
    (connect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await sm.reconnect("conn:1");
    expect(sm.active?.status).toBe("connected");
    expect(connect).toHaveBeenLastCalledWith("conn:1", "u", false);
    expect(sm.sessions.length).toBe(1);
    expect(sm.active?.connectedAt).toBeTruthy();
  });

  it("cross-session DDL only closes the owning session's tabs", async () => {
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
    sm.openDocument({ kind: "document", db: "d", coll: "c", mode: "edit", initial: null, idText: "1" });
    await sm.focusOrOpen({ connId: 2, uri: "u2", label: "b" });
    sm.openDocument({ kind: "document", db: "d", coll: "c", mode: "edit", initial: null, idText: "1" });
    sm.closeForCollection("conn:1", "d", "c");
    expect(sm.workTabs.map((t) => t.sessionId)).toEqual(["conn:2"]);
  });
});

const insertDoc = (db: string, coll: string) =>
  ({ kind: "document", db, coll, mode: "insert", initial: null, idText: null }) as const;
const editDoc = (id: string) =>
  ({ kind: "document", db: "d", coll: "c", mode: "edit", initial: {}, idText: id }) as const;

describe("sessionManager work tabs", () => {
  let sm: ReturnType<typeof createSessionManager>;
  beforeEach(async () => {
    sm = createSessionManager();
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
  });

  it("openDocument insert always opens a new tab and activates it", () => {
    sm.openDocument(insertDoc("d", "c"));
    sm.openDocument(insertDoc("d", "c"));
    expect(sm.workTabs.length).toBe(2);
    expect(sm.activeZone).toEqual({ zone: "work", id: sm.workTabs[1].id });
  });

  it("openDocument edit deduplicates by idText within the active session", () => {
    sm.openDocument(editDoc('{"$oid":"1"}'));
    sm.openDocument(editDoc('{"$oid":"1"}'));
    expect(sm.workTabs.length).toBe(1);
    expect(sm.activeZone).toEqual({ zone: "work", id: sm.workTabs[0].id });
  });

  it("activateWork changes the active tab", () => {
    sm.openDocument(editDoc('{"$oid":"1"}'));
    sm.openDocument(editDoc('{"$oid":"2"}'));
    const first = sm.workTabs[0].id;
    sm.activateWork(first);
    expect(sm.activeZone).toEqual({ zone: "work", id: first });
  });

  it("closeWork on active tab falls back to the adjacent work tab", () => {
    sm.openDocument(editDoc('{"$oid":"1"}'));
    sm.openDocument(editDoc('{"$oid":"2"}'));
    sm.closeWork(sm.workTabs[1].id);
    expect(sm.workTabs.length).toBe(1);
    expect(sm.activeZone).toEqual({ zone: "work", id: sm.workTabs[0].id });
  });

  it("closeWork last work tab with an active session falls back to host context", () => {
    sm.openDocument(insertDoc("d", "c"));
    sm.closeWork(sm.workTabs[0].id);
    expect(sm.workTabs.length).toBe(0);
    expect(sm.activeZone).toEqual({ zone: "context", kind: "host" });
  });

  it("closeWork on an inactive tab keeps the active zone unchanged", () => {
    sm.openDocument(editDoc('{"$oid":"1"}'));
    sm.openDocument(editDoc('{"$oid":"2"}'));
    const before = sm.activeZone;
    sm.closeWork(sm.workTabs[0].id);
    expect(sm.activeZone).toEqual(before);
  });
});

describe("sessionManager query tabs", () => {
  let sm: ReturnType<typeof createSessionManager>;
  beforeEach(async () => {
    sm = createSessionManager();
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
  });

  it("openQuery adds a persistent query tab with an incrementing seq", () => {
    sm.openQuery("a");
    sm.openQuery("b");
    const queries = sm.workTabs.filter((t) => t.kind === "query");
    expect(queries.map((t) => (t.kind === "query" ? t.seq : 0))).toEqual([1, 2]);
    expect(sm.activeZone).toEqual({ zone: "work", id: queries[1].id });
  });

  it("reuses the lowest free Query number after closing", () => {
    sm.openQuery("a");
    sm.openQuery("b"); // #1, #2
    const first = sm.workTabs.find((t) => t.kind === "query" && t.seq === 1)!;
    sm.closeWork(first.id);
    sm.openQuery("c"); // should reuse #1
    expect(
      sm.workTabs.filter((t) => t.kind === "query").map((t) => (t.kind === "query" ? t.seq : 0)).sort(),
    ).toEqual([1, 2]);
  });
});

describe("sessionManager DDL tab cleanup", () => {
  let sm: ReturnType<typeof createSessionManager>;
  beforeEach(async () => {
    sm = createSessionManager();
    await sm.focusOrOpen({ connId: 1, uri: "u1", label: "a" });
  });

  it("closeForCollection closes matching work tabs and demotes selection to db level", () => {
    sm.active!.nav.selectCollection("d", "c");
    sm.openDocument(insertDoc("d", "c"));
    sm.closeForCollection("conn:1", "d", "c");
    expect(sm.workTabs.length).toBe(0);
    expect(sm.active!.nav.selection).toEqual({ db: "d", coll: null });
  });

  it("closeForCollection on the active view demotes the zone to the database context (not host)", () => {
    sm.active!.nav.selectCollection("d", "c");
    sm.showContext("data");
    sm.openDocument(insertDoc("d", "c"));
    sm.closeForCollection("conn:1", "d", "c");
    expect(sm.activeZone).toEqual({ zone: "context", kind: "database" });
    expect(sm.active!.nav.selColl).toBeNull();
  });

  it("closeForCollection on an inactive session does not touch the active zone", async () => {
    sm.active!.nav.selectCollection("d", "c");
    sm.showContext("data");
    await sm.focusOrOpen({ connId: 2, uri: "u2", label: "b" });
    sm.focusSession("conn:2");
    sm.closeForCollection("conn:1", "d", "c");
    expect(sm.activeZone).toEqual({ zone: "context", kind: "data" });
  });

  it("closeForCollection with a non-matching selection leaves selection unchanged", () => {
    sm.active!.nav.selectCollection("d", "other");
    sm.closeForCollection("conn:1", "d", "c");
    expect(sm.active!.nav.selection).toEqual({ db: "d", coll: "other" });
  });

  it("closeForDatabase closes work tabs for the db and clears selection", () => {
    sm.active!.nav.selectCollection("d", "c");
    sm.openDocument(insertDoc("d", "a"));
    sm.openDocument(insertDoc("other", "z"));
    sm.closeForDatabase("conn:1", "d");
    expect(sm.workTabs.length).toBe(1);
    const tab0 = sm.workTabs[0];
    if (tab0.kind !== "document") throw new Error("expected document tab");
    expect(tab0.db).toBe("other");
    expect(sm.active!.nav.selection).toBeNull();
  });

  it("renameCollectionTabs updates work tab names, selection, and bumps version", () => {
    sm.active!.nav.selectCollection("d", "old");
    sm.openDocument(insertDoc("d", "old"));
    sm.renameCollectionTabs("conn:1", "d", "old", "new");
    const renamed = sm.workTabs[0];
    if (renamed.kind !== "document") throw new Error("expected document tab");
    expect(renamed.coll).toBe("new");
    expect(sm.active!.nav.selection).toEqual({ db: "d", coll: "new" });
    expect(sm.active!.nav.collectionVersion("d", "new")).toBe(1);
  });
});
