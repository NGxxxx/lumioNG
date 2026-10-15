import { describe, it, expect, beforeEach } from "vitest";
import { createQueryHistory, QUERY_HISTORY_KEY } from "./queryHistory.svelte";
import { createRecentCollections } from "./recentCollections.svelte";
import { settings } from "./settings.svelte";

beforeEach(() => {
  localStorage.clear();
  settings.setRecordQueryHistory(true);
});

const run = (script: string, tabId = 1) => ({
  tabId, sessionLabel: "staging", connId: 2, db: "shop", script, at: Date.now(), ms: 12,
  outcome: { kind: "docs" as const, n: 3 },
});

describe("queryHistory store", () => {
  it("records runs (same tab + script merges) and persists", () => {
    const h = createQueryHistory();
    h.record(run("db.a.find()"));
    h.record(run("db.a.find()"));
    h.record(run("db.b.find()"));
    expect(h.entries.map((e) => [e.script, e.runs])).toEqual([["db.b.find()", 1], ["db.a.find()", 2]]);
    expect(createQueryHistory().entries).toHaveLength(2);
  });

  it("records nothing when the setting is off; clear empties it", () => {
    const h = createQueryHistory();
    settings.setRecordQueryHistory(false);
    h.record(run("db.a.find()"));
    expect(h.entries).toEqual([]);
    settings.setRecordQueryHistory(true);
    h.record(run("db.a.find()"));
    h.clear();
    expect(h.entries).toEqual([]);
    expect(localStorage.getItem(QUERY_HISTORY_KEY)).toBe("[]");
  });

  it("corrupt storage starts empty", () => {
    localStorage.setItem(QUERY_HISTORY_KEY, "{{");
    expect(createQueryHistory().entries).toEqual([]);
  });
});

describe("recentCollections store", () => {
  it("keeps the newest first without duplicates, capped", () => {
    const r = createRecentCollections();
    r.touch(1, "shop", "orders");
    r.touch(1, "shop", "users");
    r.touch(1, "shop", "orders");
    expect(r.list.map((c) => c.coll)).toEqual(["orders", "users"]);
    for (let i = 0; i < 30; i++) r.touch(1, "db", `c${i}`);
    expect(r.list.length).toBe(20);
    expect(createRecentCollections().list[0].coll).toBe("c29");
  });
});
