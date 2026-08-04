import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import DocumentForm from "./DocumentForm.svelte";
import * as documents from "../api/documents";
import { proxiedDoc } from "./DocumentForm.test-helpers.svelte";
import { disposeFieldSuggestions } from "../stores/fieldSuggestions";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn(),
  replaceDocument: vi.fn(),
  sampleDocuments: vi.fn(async () => []),
}));
vi.mock("../domain/docid", () => ({
  idJson: vi.fn(() => '{"$oid":"abc"}'),
}));
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: { id: "sess1" } },
}));

// The Tree tab's virtualizer needs a non-zero container size to mount any rows (jsdom is 0 by default).
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

// The shared fieldSuggestions cache is module-level (keyed by session:db.coll) — every test here
// mounts DocumentForm against the same mocked "sess1"/"d"/"c", so a stale cache entry from an
// earlier test would silently make a later test's sampleDocuments mock never get called.
beforeEach(() => disposeFieldSuggestions("sess1"));

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

    expect(documents.insertDocument).toHaveBeenCalledWith("sess1", "d", "c", '{"a":1}');
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
      "sess1",
      "d",
      "c",
      '{"$oid":"abc"}',
      '{"_id":{"$oid":"abc"},"a":2}',
    );
  });

  it("initial doc coming from a $state store (reactive proxy, e.g. workTabs) mounts without throwing", async () => {
    // unlike the other tests' plain object — mirrors workTabs, a deep $state array.
    const initial = proxiedDoc({ _id: { $oid: "abc" }, a: 1, nested: { b: 2 } });
    const { getByText } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved: () => {}, oncancel: () => {} },
    });

    expect(getByText("Save")).toBeTruthy();
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

describe("DocumentForm — field suggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches top-level-only field suggestions and forwards them to TreeEditor's add-field row", async () => {
    (documents.sampleDocuments as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { _id: { $oid: "1" }, name: "Ann", address: { city: "Hue" } },
    ]);
    const { container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved: () => {}, oncancel: () => {} },
    });
    const input = container.querySelector("input.name") as HTMLInputElement;
    await waitFor(async () => {
      await fireEvent.focus(input);
      expect(container.querySelectorAll(".suggest-option").length).toBeGreaterThan(0);
    });
    const options = Array.from(container.querySelectorAll(".suggest-option .suggest-label")).map((o) => o.textContent);
    expect(options).toEqual(["name"]); // "address.city" is dropped: dotted paths aren't valid top-level document keys
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
      "sess1",
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
