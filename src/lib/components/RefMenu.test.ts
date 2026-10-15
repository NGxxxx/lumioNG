import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import RefMenu from "./RefMenu.svelte";
import type { RefJump, RefMenu as Menu } from "../stores/refJump.svelte";

const OID = { $oid: "652f1a9e0000000000000c41" };
function jumpWith(menu: Partial<Menu> | null): RefJump {
  return {
    menu: menu && {
      input: { path: "customerId", value: OID, db: "shop", coll: "orders" }, anchor: null, targets: [], notFoundIn: null,
      remembered: null, searching: null, confirmSearch: false, notFoundAnywhere: false, error: null, ...menu,
    },
    pending: false,
    jump: vi.fn(), pick: vi.fn(), searchAll: vi.fn(), cancelSearch: vi.fn(), forget: vi.fn(), closeMenu: vi.fn(),
  } as unknown as RefJump;
}
const colls = () => ["orders", "customers", "users", "system.views"];

describe("RefMenu", () => {
  it("renders nothing without a menu", () => {
    const { container } = render(RefMenu, { props: { jump: jumpWith(null), collections: colls } });
    expect(container.querySelector(".refmenu")).toBeNull();
  });

  it("lists candidates; picking one calls pick", async () => {
    const j = jumpWith({ targets: [{ db: "shop", coll: "customer" }, { db: "shop", coll: "customers" }] });
    const { getByRole } = render(RefMenu, { props: { jump: j, collections: colls } });
    await fireEvent.click(getByRole("button", { name: "customers" }));
    expect(j.pick).toHaveBeenCalledWith({ db: "shop", coll: "customers" });
  });

  it("not found note, choose another collection (filterable, no system.*), whole-db search", async () => {
    const j = jumpWith({ notFoundIn: "customers" });
    const { getByText, getByRole, getByLabelText, queryByRole } = render(RefMenu, { props: { jump: j, collections: colls } });
    expect(getByText("Not in customers")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Choose another collection…" }));
    expect(queryByRole("button", { name: "system.views" })).toBeNull();
    await fireEvent.input(getByLabelText("Filter collections"), { target: { value: "us" } });
    expect(queryByRole("button", { name: "orders" })).toBeNull();
    await fireEvent.click(getByRole("button", { name: "users" }));
    expect(j.pick).toHaveBeenCalledWith({ db: "shop", coll: "users" });
    await fireEvent.click(getByRole("button", { name: "Search the whole database" }));
    expect(j.searchAll).toHaveBeenCalled();
  });

  it("remembered line with Forget; search progress with Stop; PROD confirmation", async () => {
    const a = jumpWith({ remembered: "customers" });
    const r1 = render(RefMenu, { props: { jump: a, collections: colls } });
    expect(r1.getByText("Remembered: customerId → customers")).toBeTruthy();
    await fireEvent.click(r1.getByRole("button", { name: "Forget" }));
    expect(a.forget).toHaveBeenCalled();
    r1.unmount();
    const b = jumpWith({ searching: { done: 3, total: 9 } });
    const r2 = render(RefMenu, { props: { jump: b, collections: colls } });
    expect(r2.getByText("Searching 3 / 9…")).toBeTruthy();
    await fireEvent.click(r2.getByRole("button", { name: "Stop" }));
    expect(b.cancelSearch).toHaveBeenCalled();
    r2.unmount();
    const c = jumpWith({ confirmSearch: true });
    const r3 = render(RefMenu, { props: { jump: c, collections: colls } });
    expect(r3.getByText(/every collection of a PROD database/)).toBeTruthy();
  });

  it("Escape closes", async () => {
    const j = jumpWith({});
    const { getByRole } = render(RefMenu, { props: { jump: j, collections: colls } });
    await fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    expect(j.closeMenu).toHaveBeenCalled();
  });
});

describe("RefMenu — fresh state per click", () => {
  it("a new menu closes the collection chooser and clears its filter", async () => {
    let current: unknown = null;
    const base = jumpWith({});
    const j = { ...base, get menu() { return current; } } as unknown as RefJump;
    current = jumpWith({}).menu;
    const { getByRole, getByLabelText, queryByLabelText, rerender } = render(RefMenu, { props: { jump: j, collections: colls } });
    await fireEvent.click(getByRole("button", { name: "Choose another collection…" }));
    await fireEvent.input(getByLabelText("Filter collections"), { target: { value: "us" } });
    current = jumpWith({}).menu; // another click → a new input object
    await rerender({ jump: { ...base, menu: current } as unknown as RefJump, collections: colls });
    expect(queryByLabelText("Filter collections")).toBeNull();
  });
});
