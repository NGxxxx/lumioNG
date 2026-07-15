import { describe, it, expect } from "vitest";
import { createActiveDataView, type DataViewHandle } from "./activeDataView.svelte";

const stub = (): DataViewHandle => ({
  canEdit: true,
  canExport: true,
  canDelete: true,
  editSelected() {},
  exportCurrent() {},
  deleteSelected() {},
});

describe("activeDataView", () => {
  it("exposes the registered handle", () => {
    const s = createActiveDataView();
    const h = stub();
    s.register(h);
    expect(s.handle).toBe(h);
  });

  it("unregister only clears when the handle still matches (remount-safe)", () => {
    const s = createActiveDataView();
    const oldView = stub();
    const newView = stub();
    s.register(oldView);
    s.register(newView); // new view mounted before old cleanup
    s.unregister(oldView); // stale cleanup → no-op
    expect(s.handle).toBe(newView);
    s.unregister(newView);
    expect(s.handle).toBeNull();
  });

  it("resolves to the query handle whose id is set active, independent of registration order", () => {
    const s = createActiveDataView();
    const a = stub();
    const b = stub();
    s.registerQuery(1, a);
    s.registerQuery(2, b);
    s.setActiveQueryId(1);
    expect(s.handle).toBe(a);
    s.setActiveQueryId(2);
    expect(s.handle).toBe(b);
  });

  it("falls back to the data handle once no query id is active", () => {
    const s = createActiveDataView();
    const data = stub();
    const query = stub();
    s.register(data);
    s.registerQuery(1, query);
    s.setActiveQueryId(1);
    expect(s.handle).toBe(query);
    s.setActiveQueryId(null);
    expect(s.handle).toBe(data);
  });

  it("a query tab's handle stays registered across activate/deactivate — no register race between siblings", () => {
    const s = createActiveDataView();
    const a = stub();
    const b = stub();
    const c = stub();
    s.registerQuery(1, a);
    s.registerQuery(2, b);
    s.registerQuery(3, c);
    // Rapidly created/switched tabs, in any order — since each is registered once and stays put,
    // the resolved handle only ever depends on the last setActiveQueryId call.
    s.setActiveQueryId(2);
    s.setActiveQueryId(3);
    s.setActiveQueryId(1);
    expect(s.handle).toBe(a);
  });

  it("unregisterQuery removes only that id's handle", () => {
    const s = createActiveDataView();
    const a = stub();
    s.registerQuery(1, a);
    s.setActiveQueryId(1);
    s.unregisterQuery(1);
    expect(s.handle).toBeNull();
  });
});
