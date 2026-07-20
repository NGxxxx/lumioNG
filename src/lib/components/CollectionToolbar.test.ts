import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(),
  sampleDocuments: vi.fn(),
  replaceDocument: vi.fn(),
  deleteDocument: vi.fn(),
  fetchFullDoc: vi.fn(),
  countDocuments: vi.fn(),
  updateMany: vi.fn(),
  updateOne: vi.fn(),
  deleteMany: vi.fn(),
  exportQueryProgress: vi.fn(),
}));

vi.mock("../api/files", () => ({
  openDialog: vi.fn(),
  openDirDialog: vi.fn(),
}));

import * as documents from "../api/documents";
import { createCollectionView } from "../stores/collectionView.svelte";
import CollectionToolbar from "./CollectionToolbar.svelte";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const samp = documents.sampleDocuments as ReturnType<typeof vi.fn>;
const cnt = documents.countDocuments as ReturnType<typeof vi.fn>;

async function renderWithFields() {
  cnt.mockResolvedValue(1);
  qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1, y: 2 }]);
  samp.mockResolvedValueOnce([]);
  const v = createCollectionView("conn:1", "d", "c");
  await v.init();
  const result = render(CollectionToolbar, { props: { v } });
  await fireEvent.click(result.getByTitle("Fields"));
  return { v, ...result };
}

describe("CollectionToolbar — Fields chooser select-all checkbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is checked (not indeterminate) when every field is visible", async () => {
    const { container } = await renderWithFields();
    const master = container.querySelector(".dd-allnone input[type=checkbox]") as HTMLInputElement;
    expect(master.checked).toBe(true);
    expect(master.indeterminate).toBe(false);
  });

  it("becomes indeterminate when only some fields are hidden", async () => {
    const { v, container, getByText } = await renderWithFields();
    await fireEvent.click(getByText("x"));
    expect(v.hiddenDraft.has("x")).toBe(true);
    const master = container.querySelector(".dd-allnone input[type=checkbox]") as HTMLInputElement;
    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(true);
  });

  it("clicking the master checkbox while indeterminate shows all fields again", async () => {
    const { v, container, getByText } = await renderWithFields();
    await fireEvent.click(getByText("x"));
    const master = container.querySelector(".dd-allnone input[type=checkbox]") as HTMLInputElement;
    await fireEvent.click(master);
    expect(v.hiddenDraft.size).toBe(0);
  });

  it("clicking the master checkbox while all-checked hides every unlocked field", async () => {
    const { v, container } = await renderWithFields();
    const master = container.querySelector(".dd-allnone input[type=checkbox]") as HTMLInputElement;
    await fireEvent.click(master);
    expect(v.hiddenDraft.has("x")).toBe(true);
    expect(v.hiddenDraft.has("y")).toBe(true);
    expect(v.hiddenDraft.has("_id")).toBe(false);
  });
});
