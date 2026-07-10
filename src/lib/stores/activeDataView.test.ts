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
});
