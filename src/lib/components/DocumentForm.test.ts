import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DocumentForm from "./DocumentForm.svelte";
import * as documents from "../api/documents";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn(),
  replaceDocument: vi.fn(),
}));
vi.mock("../domain/docid", () => ({
  idJson: vi.fn(() => '{"$oid":"abc"}'),
}));
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: null },
}));

describe("DocumentForm — Raw JSON view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalid JSON syntax → blocks save, does not call backend, shows error", async () => {
    const onsaved = vi.fn();
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    await fireEvent.click(getByText("JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: "{ bad json" } });
    await fireEvent.click(getByText("Save"));

    expect(documents.insertDocument).not.toHaveBeenCalled();
    expect(onsaved).not.toHaveBeenCalled();
    expect(getByText(/syntax error/i)).toBeTruthy();
  });

  it("valid JSON in insert mode → calls insertDocument with JSON", async () => {
    const onsaved = vi.fn();
    (documents.insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue('{"$oid":"1"}');
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    await fireEvent.click(getByText("JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"a":1}' } });
    await fireEvent.click(getByText("Save"));

    expect(documents.insertDocument).toHaveBeenCalledWith("", "d", "c", '{"a":1}');
  });

  it("valid JSON in edit mode → calls replaceDocument with _id and updated JSON", async () => {
    const onsaved = vi.fn();
    (documents.replaceDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: 1 },
        onsaved,
        oncancel: () => {},
      },
    });
    await fireEvent.click(getByText("JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"_id":{"$oid":"abc"},"a":2}' } });
    await fireEvent.click(getByText("Save"));

    expect(documents.replaceDocument).toHaveBeenCalledWith(
      "",
      "d",
      "c",
      '{"$oid":"abc"}',
      '{"_id":{"$oid":"abc"},"a":2}',
    );
  });

  it("scrolling the textarea keeps the line-number gutter in sync", async () => {
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved: () => {}, oncancel: () => {} },
    });
    await fireEvent.click(getByText("JSON"));
    const textarea = container.querySelector("textarea")!;
    const gutter = container.querySelector(".gutter")!;
    expect(gutter.scrollTop).toBe(0);

    textarea.scrollTop = 42;
    await fireEvent.scroll(textarea);

    expect(gutter.scrollTop).toBe(42);
  });

  it("invalid raw JSON → switching to Tree is blocked, stays in Raw view and shows error", async () => {
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved: () => {}, oncancel: () => {} },
    });
    await fireEvent.click(getByText("JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: "{ bad json" } });
    await fireEvent.click(getByText("Field tree"));
    // textarea still present (did not switch to Tree) + syntax error shown
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(getByText(/syntax error/i)).toBeTruthy();
  });
});

describe("DocumentForm — Tree view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens in Tree view by default (no textarea), shows field", () => {
    const { container, getByText } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: "x" },
        onsaved: () => {},
        oncancel: () => {},
      },
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(getByText("a")).toBeTruthy();
  });

  it("editing a field in tree → Save calls replaceDocument with updated JSON (preserves _id)", async () => {
    const onsaved = vi.fn();
    (documents.replaceDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: "x" },
        onsaved,
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "y" } });
    await fireEvent.click(getByText("Save"));

    expect(documents.replaceDocument).toHaveBeenCalledWith(
      "",
      "d",
      "c",
      '{"$oid":"abc"}',
      JSON.stringify({ _id: { $oid: "abc" }, a: "y" }),
    );
  });

  it("type-error field in tree → Save is disabled, backend not called", async () => {
    const onsaved = vi.fn();
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, n: { $numberInt: "2" } },
        onsaved,
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } });
    const saveBtn = getByText("Save") as HTMLButtonElement;
    await fireEvent.click(saveBtn);

    expect(saveBtn.disabled).toBe(true);
    expect(documents.replaceDocument).not.toHaveBeenCalled();
    expect(onsaved).not.toHaveBeenCalled();
  });

  it("toggle Tree(error)→Raw→Tree → Save re-enables (treeValid is reset)", async () => {
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, n: { $numberInt: "2" } },
        onsaved: () => {},
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } }); // invalid value -> treeValid=false
    expect((getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByText("JSON"));
    await fireEvent.click(getByText("Field tree"));
    expect((getByText("Save") as HTMLButtonElement).disabled).toBe(false);
  });
});
