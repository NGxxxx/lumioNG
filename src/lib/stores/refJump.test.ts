import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({ findById: vi.fn() }));
vi.mock("../api/connection", () => ({ listPlainCollections: vi.fn() }));
import * as conn from "../api/connection";

import * as api from "../api/documents";
import { createRefJump } from "./refJump.svelte";
import { getRemembered } from "./refMemory";
import { memoryKey } from "../domain/refTarget";
import { prefs } from "./prefs.svelte";

const findById = api.findById as ReturnType<typeof vi.fn>;
const OID = { $oid: "652f1a9e0000000000000c41" };
const ID_TEXT = JSON.stringify(OID);
const input = (path = "customerId") => ({ path, value: OID, db: "shop", coll: "orders" });

const plain = conn.listPlainCollections as ReturnType<typeof vi.fn>;

function setup(colls = ["orders", "customers", "reviews"], prod = false) {
  plain.mockResolvedValue(colls.filter((c) => !c.startsWith("system.") && c !== "a_view"));
  const peek = { showRef: vi.fn(() => "ok") };
  const j = createRefJump({
    sessionId: () => "s", connId: () => 1, collections: () => colls,
    peek: peek as never, prod: () => prod,
  });
  return { j, peek };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createRefJump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs.clear();
  });

  it("one guessed target found → opens it in the drawer, no menu", async () => {
    findById.mockResolvedValue(JSON.stringify({ _id: OID, name: "Lena" }));
    const { j, peek } = setup();
    await j.jump(input());
    expect(findById).toHaveBeenCalledWith("s", "shop", "customers", ID_TEXT);
    expect(peek.showRef).toHaveBeenCalledWith({ _id: OID, name: "Lena" }, { db: "shop", coll: "customers" }, "customerId");
    expect(j.menu).toBeNull();
    expect(j.pending).toBe(false);
  });

  it("not found → menu says where it wasn't", async () => {
    findById.mockResolvedValue(null);
    const { j, peek } = setup();
    await j.jump(input());
    expect(peek.showRef).not.toHaveBeenCalled();
    expect(j.menu?.notFoundIn).toBe("customers");
  });

  it("many / none candidates → menu without any lookup", async () => {
    const { j } = setup(["orders", "customer", "customers"]);
    await j.jump(input());
    expect(findById).not.toHaveBeenCalled();
    expect(j.menu?.targets.map((t) => t.coll)).toEqual(["customer", "customers"]);
    await j.jump(input("ownerRef"));
    expect(j.menu?.targets).toEqual([]);
  });

  it("not an id (plain string) or the doc's own _id → nothing happens", async () => {
    const { j } = setup();
    await j.jump({ ...input(), value: "abc" });
    await j.jump({ ...input("_id") });
    expect(findById).not.toHaveBeenCalled();
    expect(j.menu).toBeNull();
  });

  it("pick + found → remembered; next jump goes straight there", async () => {
    findById.mockResolvedValue(JSON.stringify({ _id: OID }));
    const { j, peek } = setup(["orders", "accounts"]);
    await j.jump(input("ownerRef"));
    await j.pick({ db: "shop", coll: "accounts" });
    expect(getRemembered(memoryKey(1, "shop", "orders", "ownerRef"))).toBe("accounts");
    expect(peek.showRef).toHaveBeenCalledTimes(1);
    expect(j.menu).toBeNull();
    await j.jump(input("ownerRef"));
    expect(findById).toHaveBeenLastCalledWith("s", "shop", "accounts", ID_TEXT);
    expect(peek.showRef).toHaveBeenCalledTimes(2);
  });

  it("forget clears the remembered target", async () => {
    findById.mockResolvedValueOnce(null);
    const { j } = setup(["orders", "accounts"]);
    prefs.setItem("lumio.refTargets.v1", JSON.stringify({ [memoryKey(1, "shop", "orders", "ownerRef")]: { coll: "accounts", at: 1 } }));
    await j.jump(input("ownerRef"));
    expect(j.menu?.remembered).toBe("accounts");
    j.forget();
    expect(j.menu?.remembered).toBeNull();
    expect(getRemembered(memoryKey(1, "shop", "orders", "ownerRef"))).toBeNull();
  });

  it("latest click wins", async () => {
    const first = deferred<string | null>();
    findById.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(JSON.stringify({ _id: OID, n: 2 }));
    const { j, peek } = setup();
    const a = j.jump(input());
    const b = j.jump(input());
    await b;
    first.resolve(JSON.stringify({ _id: OID, n: 1 }));
    await a;
    expect(peek.showRef).toHaveBeenCalledTimes(1);
    expect(peek.showRef).toHaveBeenCalledWith({ _id: OID, n: 2 }, expect.anything(), "customerId");
  });

  it("search the whole database: sequential, skips system.* and the tried one, stops at the first hit", async () => {
    findById.mockImplementation(async (_s: string, _d: string, coll: string) => (coll === "reviews" ? JSON.stringify({ _id: OID }) : null));
    const { j, peek } = setup(["customers", "orders", "system.views", "reviews", "zeta"]);
    await j.jump(input());
    await j.searchAll();
    const tried = findById.mock.calls.map((c) => c[2]);
    expect(tried).toEqual(["customers", "orders", "reviews"]);
    expect(peek.showRef).toHaveBeenCalledWith({ _id: OID }, { db: "shop", coll: "reviews" }, "customerId");
  });

  it("search reports when nothing matched", async () => {
    findById.mockResolvedValue(null);
    const { j } = setup(["customers", "orders"]);
    await j.jump(input());
    await j.searchAll();
    expect(j.menu?.notFoundAnywhere).toBe(true);
    expect(j.menu?.searching).toBeNull();
  });

  it("cancelSearch stops after the current lookup", async () => {
    const d = deferred<string | null>();
    findById.mockResolvedValueOnce(null).mockImplementationOnce(() => d.promise).mockResolvedValue(null);
    const { j } = setup(["customers", "a", "b", "c"]);
    await j.jump(input());
    const p = j.searchAll();
    await vi.waitFor(() => expect(findById).toHaveBeenCalledTimes(2));
    j.cancelSearch();
    d.resolve(null);
    await p;
    expect(findById).toHaveBeenCalledTimes(2);
    expect(j.menu?.searching).toBeNull();
  });

  it("PROD: the whole-database search asks once first", async () => {
    findById.mockResolvedValue(null);
    const { j } = setup(["customers", "orders"], true);
    await j.jump(input());
    await j.searchAll();
    expect(j.menu?.confirmSearch).toBe(true);
    expect(findById).toHaveBeenCalledTimes(1);
    await j.searchAll();
    expect(findById).toHaveBeenCalledTimes(2);
  });
});

describe("createRefJump — array elements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs.clear();
  });

  it("productIds.2 guesses products and shares memory with the field", async () => {
    findById.mockResolvedValue(JSON.stringify({ _id: OID }));
    const { j, peek } = setup(["orders", "products"]);
    await j.jump({ path: "productIds.2", value: OID, db: "shop", coll: "orders" });
    expect(findById).toHaveBeenCalledWith("s", "shop", "products", ID_TEXT);
    expect(peek.showRef).toHaveBeenCalledWith(expect.anything(), { db: "shop", coll: "products" }, "productIds");
  });
});

describe("createRefJump — whole-database search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs.clear();
  });

  it("never looks inside views (only real collections are searched)", async () => {
    findById.mockResolvedValue(null);
    const { j } = setup(["orders", "customers", "a_view", "zeta"]);
    await j.jump(input());
    await j.searchAll();
    // the first call is the guessed target; the search then skips it and the view
    expect(findById.mock.calls.map((c) => c[2])).toEqual(["customers", "orders", "zeta"]);
  });

  it("can't list collections → no blind search, error shown", async () => {
    const { j } = setup();
    findById.mockResolvedValue(null);
    await j.jump(input());
    plain.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    await j.searchAll();
    expect(findById).toHaveBeenCalledTimes(1);
    expect(j.menu?.error).toMatch(/not authorized/);
  });
});
