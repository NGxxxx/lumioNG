import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("../api/documents", () => ({
  replaceDocument: vi.fn().mockResolvedValue(undefined),
}));

import { replaceDocument } from "../api/documents";
import DocPeekDrawer from "./DocPeekDrawer.svelte";
import { createDocPeek } from "../stores/docPeek.svelte";
import type { Doc } from "../domain/doc";

const DOC: Doc = { _id: { $oid: "652f1a9e0000000000000c41" }, status: "pending", customer: { name: "Lena", tier: "gold" } };

function makePeek(over: Partial<Parameters<typeof createDocPeek>[0]> = {}) {
  return createDocPeek({
    sessionId: () => "s1",
    db: () => "shop",
    coll: () => "orders",
    loadFull: async (d) => d,
    readOnly: () => false,
    onSaved: vi.fn(),
    ...over,
  });
}

function props(peek: ReturnType<typeof makePeek>, over: Record<string, unknown> = {}) {
  return {
    peek,
    pinned: false,
    width: 360,
    selectionCount: 1,
    onresize: vi.fn(),
    onpin: vi.fn(),
    onopentab: vi.fn(),
    onduplicate: vi.fn(),
    ondelete: vi.fn(),
    onbulk: vi.fn(),
    ...over,
  };
}

beforeEach(() => vi.mocked(replaceDocument).mockClear());

describe("DocPeekDrawer", () => {
  it("renders the document's fields; objects expand in place", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const { getByText, queryByText, getByRole } = render(DocPeekDrawer, { props: props(peek) });
    expect(getByText("status")).toBeTruthy();
    expect(getByText('"pending"')).toBeTruthy();
    expect(queryByText('"Lena"')).toBeNull();
    await fireEvent.click(getByRole("button", { name: /customer/ }));
    expect(getByText('"Lena"')).toBeTruthy();
  });

  it("JSON tab shows the Extended JSON text", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const { getByRole, container } = render(DocPeekDrawer, { props: props(peek) });
    await fireEvent.click(getByRole("tab", { name: "JSON" }));
    expect(container.querySelector("pre")?.textContent).toContain('"$oid": "652f1a9e0000000000000c41"');
  });

  it("hides Edit and Delete when the document can't be edited", async () => {
    const peek = makePeek();
    await peek.show({ n: 1 } as Doc);
    const { queryByRole, getByRole } = render(DocPeekDrawer, { props: props(peek) });
    expect(queryByRole("button", { name: "Edit" })).toBeNull();
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
    expect(getByRole("button", { name: "Duplicate" })).toBeTruthy();
  });

  it("editing shows the diff bar with per-field changes, and Save writes the document", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const { getByRole, getByText } = render(DocPeekDrawer, { props: props(peek) });
    await fireEvent.click(getByRole("button", { name: "Edit" }));
    peek.setDraft({ ...peek.doc!, status: "shipped" });
    await tick();
    expect(getByText("1 change")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "1 change" }));
    expect(getByText('status: "pending" → "shipped"')).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Save" }));
    expect(replaceDocument).toHaveBeenCalled();
  });

  it("closing with unsaved changes asks first; Discard closes", async () => {
    const peek = makePeek();
    await peek.show(DOC, true);
    peek.setDraft({ ...peek.doc!, status: "x" });
    const { getByRole } = render(DocPeekDrawer, { props: props(peek) });
    await fireEvent.click(getByRole("button", { name: "Close" }));
    expect(peek.open).toBe(true);
    await fireEvent.click(getByRole("button", { name: "Discard" }));
    expect(peek.open).toBe(false);
  });

  it("a pending switch from the store shows the same Save / Discard / Stay prompt", async () => {
    const peek = makePeek();
    await peek.show(DOC, true);
    peek.setDraft({ ...peek.doc!, status: "x" });
    await peek.follow({ _id: { $oid: "other" }, status: "y" } as Doc);
    const { getByRole } = render(DocPeekDrawer, { props: props(peek) });
    expect(getByRole("alertdialog")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Stay" }));
    expect(peek.confirm).toBeNull();
  });

  it("huge values are truncated in Fields and JSON", async () => {
    const peek = makePeek();
    await peek.show({ _id: { $oid: "a" }, blob: "x".repeat(200_000) } as Doc);
    const { container, getByRole } = render(DocPeekDrawer, { props: props(peek) });
    expect(container.querySelector(".fields")!.textContent!.length).toBeLessThan(20_000);
    await fireEvent.click(getByRole("tab", { name: "JSON" }));
    expect(container.querySelector("pre")!.textContent!.length).toBeLessThan(20_000);
  });

  it("Pin and Open in tab call their callbacks", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const p = props(peek);
    const { getByRole } = render(DocPeekDrawer, { props: p });
    await fireEvent.click(getByRole("button", { name: "Pin" }));
    expect(p.onpin).toHaveBeenCalledWith(true);
    await fireEvent.click(getByRole("button", { name: "Open in tab" }));
    expect(p.onopentab).toHaveBeenCalledWith(DOC);
  });

  it("with several rows selected shows the bulk actions", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const p = props(peek, { selectionCount: 3 });
    const { getByText, getByRole } = render(DocPeekDrawer, { props: p });
    expect(getByText("3 documents selected")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Delete selected" }));
    expect(p.onbulk).toHaveBeenCalledWith("delete");
    expect(getByRole("button", { name: "Copy JSON" })).toBeTruthy();
    expect(getByRole("button", { name: "Export selection" })).toBeTruthy();
  });

  it("shows the stale note when the document left the page while being edited", async () => {
    const peek = makePeek();
    await peek.show(DOC, true);
    peek.setDraft({ ...peek.doc!, status: "x" });
    peek.sync([]);
    const { getByText } = render(DocPeekDrawer, { props: props(peek) });
    expect(getByText(/no longer in this page/)).toBeTruthy();
  });

  it("canDuplicate=false hides Duplicate", async () => {
    const peek = makePeek();
    await peek.show(DOC);
    const { queryByRole } = render(DocPeekDrawer, { props: props(peek, { canDuplicate: false }) });
    expect(queryByRole("button", { name: "Duplicate" })).toBeNull();
  });

  it("a load error offers Retry", async () => {
    let fail = true;
    const peek = makePeek({ loadFull: async (d) => { if (fail) throw new Error("offline"); return d; } });
    await peek.show(DOC);
    const { getByRole, findByText } = render(DocPeekDrawer, { props: props(peek) });
    fail = false;
    await fireEvent.click(getByRole("button", { name: "Retry" }));
    expect(await findByText("status")).toBeTruthy();
  });

  it("with several rows selected, a dirty draft keeps the editor visible with a note", async () => {
    const peek = makePeek();
    await peek.show(DOC, true);
    peek.setDraft({ ...peek.doc!, status: "x" });
    const { container, getByText } = render(DocPeekDrawer, { props: props(peek, { selectionCount: 3 }) });
    expect(getByText(/still editing this document/)).toBeTruthy();
    expect(container.querySelector(".body")).toBeTruthy();
  });
});

describe("DocPeekDrawer — references", () => {
  const ORDER: Doc = { _id: { $oid: "652f1a9e0000000000000c41" }, customerId: { $oid: "652f1a9e0000000000000001" }, total: 5 };
  const CUST: Doc = { _id: { $oid: "652f1a9e0000000000000001" }, name: "Lena" };

  it("→ next to an ObjectId field (not _id) calls onref with the field path", async () => {
    const peek = makePeek();
    await peek.show(ORDER);
    const onref = vi.fn();
    const { getAllByRole } = render(DocPeekDrawer, { props: props(peek, { onref }) });
    const arrows = getAllByRole("button", { name: "Open the referenced document" });
    expect(arrows).toHaveLength(1);
    await fireEvent.click(arrows[0]);
    expect(onref).toHaveBeenCalledWith("customerId", ORDER.customerId, expect.anything());
  });

  it("a followed document shows the trail and Back; host-only actions are replaced by Open in tab", async () => {
    const peek = makePeek();
    await peek.show(ORDER);
    peek.showRef(CUST, { db: "shop", coll: "customers" }, "customerId");
    const onopenreftab = vi.fn();
    const { getByText, getByRole, queryByRole } = render(DocPeekDrawer, { props: props(peek, { onref: vi.fn(), onopenreftab }) });
    expect(getByText("orders")).toBeTruthy();
    expect(getByText(/› customerId/)).toBeTruthy();
    expect(getByText("customers")).toBeTruthy();
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
    expect(queryByRole("button", { name: "Duplicate" })).toBeNull();
    await fireEvent.click(getByRole("button", { name: "Open in customers tab" }));
    expect(onopenreftab).toHaveBeenCalledWith({ db: "shop", coll: "customers" }, CUST);
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await tick();
    expect(peek.doc).toEqual(ORDER);
    expect(queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Backspace / Alt+← go back", async () => {
    const peek = makePeek();
    await peek.show(ORDER);
    peek.showRef(CUST, { db: "shop", coll: "customers" }, "customerId");
    const { getByRole } = render(DocPeekDrawer, { props: props(peek, { onref: vi.fn() }) });
    await fireEvent.keyDown(getByRole("complementary"), { key: "Backspace" });
    expect(peek.doc).toEqual(ORDER);
    peek.showRef(CUST, { db: "shop", coll: "customers" }, "customerId");
    await fireEvent.keyDown(getByRole("complementary"), { key: "ArrowLeft", altKey: true });
    expect(peek.doc).toEqual(ORDER);
  });
});
