import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  replaceDocument: vi.fn().mockResolvedValue(undefined),
}));

import { replaceDocument } from "../api/documents";
import { createDocPeek, docPeekFor } from "./docPeek.svelte";
import type { Doc } from "../domain/doc";

const doc = (status = "pending"): Doc => ({ _id: { $oid: "652f1a9e0000000000000c41" }, status, total: { $numberDecimal: "1.00" } });

function setup(over: Partial<Parameters<typeof createDocPeek>[0]> = {}) {
  const onSaved = vi.fn();
  const loadFull = vi.fn(async (d: Doc) => ({ ...d, extra: "full" }) as Doc);
  const peek = createDocPeek({
    sessionId: () => "s1",
    db: () => "shop",
    coll: () => "orders",
    loadFull,
    readOnly: () => false,
    onSaved,
    ...over,
  });
  return { peek, onSaved, loadFull };
}

beforeEach(() => vi.mocked(replaceDocument).mockClear().mockResolvedValue(undefined));

describe("docPeek", () => {
  it("starts closed", () => {
    const { peek } = setup();
    expect(peek.open).toBe(false);
    expect(peek.doc).toBeNull();
  });

  it("show loads the full document and opens in view mode", async () => {
    const { peek, loadFull } = setup();
    await peek.show(doc());
    expect(loadFull).toHaveBeenCalled();
    expect(peek.open).toBe(true);
    expect(peek.mode).toBe("view");
    expect(peek.doc).toMatchObject({ extra: "full" });
  });

  it("show(d, true) opens straight into edit mode", async () => {
    const { peek } = setup();
    await peek.show(doc(), true);
    expect(peek.mode).toBe("edit");
    expect(peek.draft).toEqual(peek.doc);
  });

  it("a load failure is reported and keeps the drawer open", async () => {
    const { peek } = setup({ loadFull: vi.fn().mockRejectedValue(new Error("boom")) });
    await peek.show(doc());
    expect(peek.open).toBe(true);
    expect(peek.error).toContain("boom");
    expect(peek.doc).toBeNull();
  });

  it("setDraft computes the changes", async () => {
    const { peek } = setup();
    await peek.show(doc(), true);
    peek.setDraft({ ...peek.doc!, status: "shipped" });
    expect(peek.changes).toEqual([{ path: "status", kind: "changed", before: "pending", after: "shipped" }]);
  });

  it("save replaces the document, logs, reports it and returns to view mode", async () => {
    const { peek, onSaved } = setup();
    await peek.show(doc(), true);
    const next = { ...peek.doc!, status: "shipped" };
    peek.setDraft(next);
    expect(await peek.save()).toBe(true);
    expect(replaceDocument).toHaveBeenCalledWith("s1", "shop", "orders", '{"$oid":"652f1a9e0000000000000c41"}', JSON.stringify(next));
    expect(onSaved).toHaveBeenCalledWith(next);
    expect(peek.mode).toBe("view");
    expect(peek.doc).toEqual(next);
    expect(peek.changes).toEqual([]);
  });

  it("a save error keeps the draft and reports the error", async () => {
    vi.mocked(replaceDocument).mockRejectedValueOnce(new Error("dup key"));
    const { peek, onSaved } = setup();
    await peek.show(doc(), true);
    peek.setDraft({ ...peek.doc!, status: "shipped" });
    expect(await peek.save()).toBe(false);
    expect(peek.error).toContain("dup key");
    expect(peek.mode).toBe("edit");
    expect(peek.changes).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("discard restores the original", async () => {
    const { peek } = setup();
    await peek.show(doc(), true);
    peek.setDraft({ ...peek.doc!, status: "shipped" });
    peek.discard();
    expect(peek.mode).toBe("view");
    expect(peek.changes).toEqual([]);
  });

  it("follow switches documents when clean, refuses when dirty", async () => {
    const { peek } = setup();
    await peek.show(doc("a"));
    expect(await peek.follow({ ...doc("b"), _id: { $oid: "b" } })).toBe("ok");
    expect(peek.doc).toMatchObject({ status: "b" });
    peek.startEdit();
    peek.setDraft({ ...peek.doc!, status: "c" });
    expect(await peek.follow({ ...doc("d"), _id: { $oid: "d" } })).toBe("dirty");
    expect(peek.doc).toMatchObject({ status: "b" });
  });

  it("close is refused while dirty", async () => {
    const { peek } = setup();
    await peek.show(doc(), true);
    peek.setDraft({ ...peek.doc!, status: "x" });
    expect(peek.close()).toBe("dirty");
    expect(peek.open).toBe(true);
    peek.discard();
    expect(peek.close()).toBe("ok");
    expect(peek.open).toBe(false);
  });

  it("canEdit is false without an _id, without a collection, or when read-only", async () => {
    const a = setup();
    await a.peek.show({ n: 1 } as Doc);
    expect(a.peek.canEdit).toBe(false);
    const b = setup({ coll: () => null });
    await b.peek.show(doc());
    expect(b.peek.canEdit).toBe(false);
    const c = setup({ readOnly: () => true });
    await c.peek.show(doc());
    expect(c.peek.canEdit).toBe(false);
    const d = setup();
    await d.peek.show(doc());
    expect(d.peek.canEdit).toBe(true);
  });

  it("startEdit does nothing when the document can't be edited", async () => {
    const { peek } = setup({ readOnly: () => true });
    await peek.show(doc());
    peek.startEdit();
    expect(peek.mode).toBe("view");
  });

  it("sync: a vanished doc closes a clean drawer but keeps a dirty draft flagged stale", async () => {
    const clean = setup();
    await clean.peek.show(doc());
    clean.peek.sync([]);
    expect(clean.peek.open).toBe(false);

    const dirty = setup();
    await dirty.peek.show(doc(), true);
    dirty.peek.setDraft({ ...dirty.peek.doc!, status: "x" });
    dirty.peek.sync([]);
    expect(dirty.peek.open).toBe(true);
    expect(dirty.peek.stale).toBe(true);
  });

  it("sync: a clean drawer picks up a changed row; a dirty one flags the conflict instead", async () => {
    const { peek, loadFull } = setup();
    const row = doc("pending");
    await peek.show(row);
    loadFull.mockClear();
    peek.sync([row]); // same row object: nothing to do
    expect(loadFull).not.toHaveBeenCalled();
    const changed = doc("shipped");
    peek.sync([changed]);
    await vi.waitFor(() => expect(peek.doc).toMatchObject({ status: "shipped" }));

    peek.startEdit();
    peek.setDraft({ ...peek.doc!, total: 9 });
    peek.sync([doc("cancelled")]);
    expect(peek.stale).toBe(true);
    expect(peek.draft).toMatchObject({ status: "shipped", total: 9 });
  });

  it("save writes to the db/coll the document was shown from, not the current one", async () => {
    let coll = "orders";
    const { peek } = setup({ coll: () => coll });
    await peek.show(doc(), true);
    coll = "archive";
    peek.setDraft({ ...peek.doc!, status: "shipped" });
    await peek.save();
    expect(vi.mocked(replaceDocument).mock.calls[0][2]).toBe("orders");
  });

  it("following another doc while dirty asks first; Discard then switches", async () => {
    const { peek } = setup();
    await peek.show(doc("a"), true);
    peek.setDraft({ ...peek.doc!, status: "z" });
    expect(await peek.follow({ ...doc("b"), _id: { $oid: "b" } })).toBe("dirty");
    expect(peek.confirm).toBe("switch");
    await peek.confirmDiscard();
    expect(peek.confirm).toBeNull();
    expect(peek.doc).toMatchObject({ status: "b" });
  });

  it("requestClose while dirty asks; Stay keeps everything; Save saves and closes", async () => {
    const { peek } = setup();
    await peek.show(doc(), true);
    peek.setDraft({ ...peek.doc!, status: "z" });
    expect(peek.requestClose()).toBe("dirty");
    expect(peek.confirm).toBe("close");
    peek.confirmStay();
    expect(peek.confirm).toBeNull();
    expect(peek.open).toBe(true);
    peek.requestClose();
    await peek.confirmSave();
    expect(replaceDocument).toHaveBeenCalled();
    expect(peek.open).toBe(false);
  });

  it("following the same document again does not reload — even after a failed load", async () => {
    const loadFull = vi.fn().mockRejectedValue(new Error("offline"));
    const { peek } = setup({ loadFull });
    await peek.show(doc());
    expect(loadFull).toHaveBeenCalledTimes(1);
    await peek.follow(doc());
    await peek.follow(doc());
    expect(loadFull).toHaveBeenCalledTimes(1);
  });

  it("docPeekFor keeps one drawer per owner (survives the host remounting)", () => {
    const owner = {};
    const deps = { sessionId: () => "s", db: () => "d", coll: () => "c", loadFull: async (d: Doc) => d, readOnly: () => false, onSaved: () => {} };
    expect(docPeekFor(owner, deps)).toBe(docPeekFor(owner, deps));
    expect(docPeekFor({}, deps)).not.toBe(docPeekFor(owner, deps));
  });

  it("retry re-runs the last load", async () => {
    let fail = true;
    const loadFull = vi.fn(async (d: Doc) => { if (fail) throw new Error("x"); return d; });
    const { peek } = setup({ loadFull });
    await peek.show(doc());
    expect(peek.error).not.toBeNull();
    fail = false;
    await peek.retry();
    expect(peek.error).toBeNull();
    expect(peek.doc).not.toBeNull();
  });

  it("refreshIfShowing reloads a clean drawer and flags a dirty one", async () => {
    const { peek, loadFull } = setup();
    await peek.show(doc());
    loadFull.mockClear();
    peek.refreshIfShowing({ sessionId: "s1", db: "shop", coll: "elsewhere" });
    expect(loadFull).not.toHaveBeenCalled();
    peek.refreshIfShowing({ sessionId: "s1", db: "shop", coll: "orders" });
    await vi.waitFor(() => expect(loadFull).toHaveBeenCalledTimes(1));
    peek.startEdit();
    peek.setDraft({ ...peek.doc!, status: "x" });
    peek.refreshIfShowing({ sessionId: "s1", db: "shop", coll: "orders" });
    expect(peek.stale).toBe(true);
    expect(peek.draft).toMatchObject({ status: "x" });
  });
});

describe("docPeek — following references", () => {
  const cust = (n: number): Doc => ({ _id: { $oid: `652f1a9e00000000000${String(n).padStart(5, "0")}` }, name: `c${n}` });

  it("showRef pushes the current doc; crumbs show the trail; back restores it", async () => {
    const { peek } = setup();
    await peek.show(doc());
    expect(peek.showRef(cust(1), { db: "shop", coll: "customers" }, "customerId")).toBe("ok");
    expect(peek.doc).toEqual(cust(1));
    expect(peek.source).toEqual({ db: "shop", coll: "customers" });
    expect(peek.crumbs).toEqual([
      { coll: "orders", via: "customerId", idTail: "0c41" },
      { coll: "customers", via: null, idTail: "0001" },
    ]);
    expect(peek.canBack).toBe(true);
    expect(peek.back()).toBe(true);
    expect(peek.doc).toMatchObject({ extra: "full" });
    expect(peek.source).toEqual({ db: "shop", coll: "orders" });
    expect(peek.crumbs).toEqual([]);
    expect(peek.back()).toBe(false);
  });

  it("saves go to the referenced document's own collection", async () => {
    const { peek } = setup();
    await peek.show(doc());
    peek.showRef(cust(1), { db: "crm", coll: "customers" }, "customerId");
    peek.startEdit();
    peek.setDraft({ ...cust(1), name: "renamed" });
    await peek.save();
    expect(replaceDocument).toHaveBeenCalledWith("s1", "crm", "customers", JSON.stringify(cust(1)._id), expect.any(String));
  });

  it("host row sync never closes or replaces a referenced document", async () => {
    const { peek } = setup();
    await peek.show(doc());
    peek.showRef(cust(1), { db: "shop", coll: "customers" }, "customerId");
    peek.sync([]);
    expect(peek.open).toBe(true);
    expect(peek.doc).toEqual(cust(1));
  });

  it("back stack is capped at 20", async () => {
    const { peek } = setup();
    await peek.show(doc());
    for (let i = 1; i <= 25; i++) peek.showRef(cust(i), { db: "shop", coll: "customers" }, "ref");
    let backs = 0;
    while (peek.back()) backs++;
    expect(backs).toBe(20);
  });

  it("with unsaved edits, following asks first and continues after Discard", async () => {
    const { peek } = setup();
    await peek.show(doc());
    peek.startEdit();
    peek.setDraft({ ...doc(), status: "x" });
    expect(peek.showRef(cust(1), { db: "shop", coll: "customers" }, "customerId")).toBe("dirty");
    expect(peek.confirm).toBe("switch");
    expect(peek.back()).toBe(false);
    await peek.confirmDiscard();
    expect(peek.doc).toEqual(cust(1));
  });

  it("a normal show clears the trail", async () => {
    const { peek } = setup();
    await peek.show(doc());
    peek.showRef(cust(1), { db: "shop", coll: "customers" }, "customerId");
    await peek.show(doc("done"));
    expect(peek.canBack).toBe(false);
    expect(peek.crumbs).toEqual([]);
  });
});

describe("docPeek — following from a closed drawer", () => {
  it("records the grid as the origin; Back closes the drawer", () => {
    const { peek } = setup();
    peek.showRef({ _id: 1, name: "Lena" }, { db: "shop", coll: "customers" }, "customerId");
    expect(peek.open).toBe(true);
    expect(peek.crumbs).toEqual([
      { coll: "orders", via: "customerId", idTail: null },
      { coll: "customers", via: null, idTail: "1" },
    ]);
    expect(peek.back()).toBe(true);
    expect(peek.open).toBe(false);
  });
});

describe("docPeek — saving a referenced document", () => {
  it("never replaces a host row when the document lives in another collection", async () => {
    const { peek, onSaved } = setup();
    await peek.show(doc());
    const user: Doc = { _id: { $oid: "652f1a9e0000000000000c41" }, name: "same _id, other collection" };
    peek.showRef(user, { db: "shop", coll: "users" }, "userId");
    peek.startEdit();
    peek.setDraft({ ...user, name: "x" });
    await peek.save();
    expect(replaceDocument).toHaveBeenCalledWith("s1", "shop", "users", expect.any(String), expect.any(String));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a referenced document of the host's own collection still refreshes its row", async () => {
    const { peek, onSaved } = setup();
    await peek.show(doc());
    const parent: Doc = { _id: { $oid: "652f1a9e0000000000000c99" }, status: "x" };
    peek.showRef(parent, { db: "shop", coll: "orders" }, "parentId");
    peek.startEdit();
    peek.setDraft({ ...parent, status: "y" });
    await peek.save();
    expect(onSaved).toHaveBeenCalledWith({ ...parent, status: "y" });
  });

  it("Back returns to the row being loaded when a jump interrupts it", async () => {
    let release!: (d: Doc) => void;
    const { peek } = setup({ loadFull: vi.fn((d: Doc) => new Promise<Doc>((r) => (release = () => r(d)))) });
    const a = doc("a");
    const b: Doc = { _id: { $oid: "652f1a9e0000000000000c42" }, status: "b" };
    const pa = peek.show(a);
    release(a);
    await pa;
    void peek.show(b); // following row B, still loading
    peek.showRef({ _id: 9 }, { db: "shop", coll: "customers" }, "customerId");
    expect(peek.back()).toBe(true);
    expect(peek.doc).toEqual(b);
  });
});
