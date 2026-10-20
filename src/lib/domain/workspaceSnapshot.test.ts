import { describe, it, expect } from "vitest";
import { snapshot, restorePlan, parseSnapshot, type LiveTab } from "./workspaceSnapshot";

const live = (over: Partial<LiveTab> = {}): LiveTab => ({
  kind: "query", connId: 1, db: "shop", coll: null, filterText: "", scriptText: "db.a.find()", ...over,
});
const conn = (id: number, environment: "" | "dev" | "staging" | "prod" = "dev", label = `c${id}`) => ({ id, label, environment });

describe("snapshot credentials", () => {
  it("masks_uri_passwords_in_saved_text", () => {
    const t: LiveTab = { kind: "query", connId: 1, db: "d", coll: null, filterText: "", scriptText: 'new MongoClient("mongodb+srv://bob:s3cret@h.example/db"); mongodb://a:b@x' };
    const s = snapshot([t]);
    expect(s.tabs[0].scriptText).toBe('new MongoClient("mongodb+srv://bob:****@h.example/db"); mongodb://a:****@x');
    expect(JSON.stringify(s)).not.toContain("s3cret");
  });
  it("leaves_text_without_credentials_alone", () => {
    const t: LiveTab = { kind: "collection", connId: 1, db: "d", coll: "c", filterText: '{"a":"mongodb://host/db"}', scriptText: "" };
    expect(snapshot([t]).tabs[0].filterText).toBe('{"a":"mongodb://host/db"}');
  });
});

describe("snapshot", () => {
  it("excludes_adhoc_connections", () => {
    const s = snapshot([live({ connId: null }), live({ connId: 2, scriptText: "keep" })], 1);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].connId).toBe(2);
    // The active index follows the surviving tab.
    expect(s.activeTab).toBe(0);
  });

  it("drops the active marker when the active tab was ad-hoc", () => {
    expect(snapshot([live({ connId: null }), live()], 0).activeTab).toBeNull();
  });

  it("keeps only text and location, never anything else", () => {
    const s = snapshot([{ ...live({ kind: "collection", db: "d", coll: "c", filterText: '{"a":1}', scriptText: "" }), extra: "rows" } as LiveTab]);
    expect(Object.keys(s.tabs[0]).sort()).toEqual(["coll", "connId", "db", "filterText", "kind", "scriptText"]);
  });
});

describe("parseSnapshot", () => {
  it("round-trips and rejects junk", () => {
    const s = snapshot([live()], 0);
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("{")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ version: 99, tabs: [] }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ version: 1, tabs: [{ kind: "x" }] }))?.tabs).toEqual([]);
  });
});

describe("restorePlan", () => {
  it("auto-connects dev and staging", () => {
    const snap = snapshot([live({ connId: 1 }), live({ connId: 2 })]);
    const plan = restorePlan(snap, [conn(1, "dev"), conn(2, "staging")]);
    expect(plan.auto.map((c) => c.connId)).toEqual([1, 2]);
    expect(plan.confirm).toEqual([]);
  });

  it("prod_tabs_require_confirmation", () => {
    const snap = snapshot([live({ connId: 1 }), live({ connId: 3 })]);
    const plan = restorePlan(snap, [conn(1, "dev"), conn(3, "prod", "Live")]);
    expect(plan.auto.map((c) => c.connId)).toEqual([1]);
    expect(plan.confirm).toEqual([{ connId: 3, label: "Live", environment: "prod" }]);
    expect(plan.tabCount).toBe(2);
  });

  it("treats unlabeled connections like prod", () => {
    const plan = restorePlan(snapshot([live({ connId: 1 })]), [conn(1, "")]);
    expect(plan.auto).toEqual([]);
    expect(plan.confirm).toHaveLength(1);
  });

  it("drops_tabs_for_deleted_connections", () => {
    const snap = snapshot([live({ connId: 1 }), live({ connId: 9 })], 1);
    const plan = restorePlan(snap, [conn(1)]);
    expect(plan.tabs.map((t) => t.connId)).toEqual([1]);
    expect(plan.dropped).toBe(1);
    expect(plan.activeTab).toBeNull();
  });

  it("lists each connection once and keeps the active index", () => {
    const snap = snapshot([live({ connId: 1 }), live({ connId: 1, scriptText: "b" })], 1);
    const plan = restorePlan(snap, [conn(1)]);
    expect(plan.auto).toHaveLength(1);
    expect(plan.activeTab).toBe(1);
  });

  it("an empty snapshot plans nothing", () => {
    const plan = restorePlan({ version: 1, tabs: [], activeTab: null }, [conn(1)]);
    expect(plan.tabCount).toBe(0);
  });
});
