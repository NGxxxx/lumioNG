import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import TreeEditor from "./TreeEditor.svelte";
import type { Doc } from "../domain/doc";

// The virtualizer needs a non-zero container size to actually mount rows (jsdom defaults to 0).
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

function setup(value: Doc) {
  let current = value;
  const onchange = vi.fn((v: Doc) => { current = v; });
  const onvalidchange = vi.fn();
  const utils = render(TreeEditor, { props: { value: current, onchange, onvalidchange } });
  return { ...utils, onchange, onvalidchange, getCurrent: () => current };
}

// The row list (expand/collapse) is debounced (see TreeEditor.svelte) — wait past it before
// asserting on rendered rows. Not needed for onchange-only assertions (that fires synchronously).
const ROWS_DEBOUNCE_MS = 120;
function waitForRows() {
  return new Promise((r) => setTimeout(r, ROWS_DEBOUNCE_MS + 30));
}

// Find-field search is debounced too (see TreeEditor.svelte); a match jump then bypasses the rows
// debounce itself, so only this wait is needed before asserting on search results.
const SEARCH_DEBOUNCE_MS = 250;
function waitForSearch() {
  return new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 30));
}

describe("TreeEditor", () => {
  it("renders only depth-0 fields collapsed (nested container children not mounted)", () => {
    const doc = { _id: { $oid: "507f1f77bcf86cd799439011" }, name: "Ann", address: { city: "Hue" } };
    const { container } = setup(doc);
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toEqual(["_id", "name", "address"]);
    expect(labels).not.toContain("city"); // nested — "address" is collapsed
  });

  it("clicking a container label expands it and mounts its children", async () => {
    const doc = { address: { city: "Hue", zip: "1000" } };
    const { container } = setup(doc);
    const addressLabel = Array.from(container.querySelectorAll(".label")).find((el) => el.textContent === "address")!;
    await fireEvent.click(addressLabel);
    await waitForRows();
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toContain("city");
    expect(labels).toContain("zip");
  });

  it("collapsing an expanded container back down does not throw (virtualizer count must shrink in step with rows)", async () => {
    // many children so rows shrinks enough for a stale virtualItems to index past it
    const doc = { address: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 } };
    const { container } = setup(doc);
    const addressLabel = Array.from(container.querySelectorAll(".label")).find((el) => el.textContent === "address")!;
    await fireEvent.click(addressLabel);
    await waitForRows();
    expect(container.querySelectorAll(".label").length).toBeGreaterThan(1);

    await fireEvent.click(addressLabel); // collapse back down
    await waitForRows();

    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toEqual(["address"]);
  });

  it("_id is locked: no remove button, shown as a non-editable display row", () => {
    const doc = { _id: { $oid: "507f1f77bcf86cd799439011" }, name: "Ann" };
    const { container } = setup(doc);
    const rows = Array.from(container.querySelectorAll(".tree-row"));
    const idRow = rows.find((r) => r.querySelector(".label")?.textContent === "_id")!;
    expect(idRow.querySelector(".x")).toBeNull();
    expect(idRow.querySelector(".lock")).toBeTruthy();
    const nameRow = rows.find((r) => r.querySelector(".label")?.textContent === "name")!;
    expect(nameRow.querySelector(".x")).toBeTruthy();
  });

  it("editing a leaf input commits the new value via onchange", async () => {
    const { container, onchange } = setup({ name: "Ann" });
    const input = container.querySelector<HTMLInputElement>(".leaf")!;
    await fireEvent.input(input, { target: { value: "Bob" } });
    expect(onchange).toHaveBeenCalledWith({ name: "Bob" });
  });

  it("editing a bare-number leaf (e.g. a Pipeline Builder mongosh literal) keeps it bare, not wrapped", async () => {
    const { container, onchange } = setup({ count: 1 }); // bare JS number, as parseMongoshValue would produce
    const input = container.querySelector<HTMLInputElement>(".leaf")!;
    await fireEvent.input(input, { target: { value: "2" } });
    expect(onchange).toHaveBeenCalledWith({ count: 2 }); // bare 2, not { $numberDouble: "2" }
  });

  it("removing a top-level field calls onchange without it", async () => {
    const { container, onchange } = setup({ name: "Ann", age: 30 });
    const rows = Array.from(container.querySelectorAll(".tree-row"));
    const ageRow = rows.find((r) => r.querySelector(".label")?.textContent === "age")!;
    await fireEvent.click(ageRow.querySelector(".x")!);
    expect(onchange).toHaveBeenCalledWith({ name: "Ann" });
  });

  it("adding a top-level field via the root adder row calls onchange with it appended", async () => {
    const { container, onchange } = setup({ name: "Ann" });
    const nameInput = container.querySelector<HTMLInputElement>(".add .name")!;
    await fireEvent.input(nameInput, { target: { value: "age" } });
    const addButton = Array.from(container.querySelectorAll(".add button")).at(-1)!;
    await fireEvent.click(addButton);
    expect(onchange).toHaveBeenCalledWith({ name: "Ann", age: "" });
  });

  it("offers fieldSuggestions via SuggestInput's dropdown on the root add-field input, none when not passed", async () => {
    const withSuggestions = render(TreeEditor, {
      props: {
        value: { name: "Ann" }, onchange: vi.fn(), onvalidchange: vi.fn(),
        fieldSuggestions: ["age", "email"],
      },
    });
    const input = withSuggestions.container.querySelector("input.name") as HTMLInputElement;
    await fireEvent.focus(input);
    const options = Array.from(withSuggestions.container.querySelectorAll(".suggest-option .suggest-label")).map((o) => o.textContent);
    expect(options).toEqual(["age", "email"]);

    const withoutSuggestions = render(TreeEditor, {
      props: { value: { name: "Ann" }, onchange: vi.fn(), onvalidchange: vi.fn() },
    });
    const plainInput = withoutSuggestions.container.querySelector("input.name") as HTMLInputElement;
    await fireEvent.focus(plainInput);
    expect(withoutSuggestions.container.querySelector(".suggest-list")).toBeNull();
  });

  it("filters out fieldSuggestions the document already has (they'd only trigger a duplicate-name error)", async () => {
    const { container } = render(TreeEditor, {
      props: {
        value: { name: "Ann" }, onchange: vi.fn(), onvalidchange: vi.fn(),
        fieldSuggestions: ["name", "age"], // "name" already exists on the document
      },
    });
    const input = container.querySelector("input.name") as HTMLInputElement;
    await fireEvent.focus(input);
    const options = Array.from(container.querySelectorAll(".suggest-option .suggest-label")).map((o) => o.textContent);
    expect(options).toEqual(["age"]); // "name" dropped, "age" kept
  });

  it("shows no suggestions when every field suggestion is already an existing key", async () => {
    const { container } = render(TreeEditor, {
      props: {
        value: { name: "Ann" }, onchange: vi.fn(), onvalidchange: vi.fn(),
        fieldSuggestions: ["name"], // the only suggestion is already an existing key
      },
    });
    const input = container.querySelector("input.name") as HTMLInputElement;
    await fireEvent.focus(input);
    expect(container.querySelector(".suggest-list")).toBeNull();
  });

  it("does not leak the root's fieldSuggestions into a nested container's own adder row", async () => {
    const { container } = render(TreeEditor, {
      props: {
        value: { a: { b: 1 } }, onchange: vi.fn(), onvalidchange: vi.fn(),
        fieldSuggestions: ["x", "y"],
      },
    });
    const aLabel = Array.from(container.querySelectorAll(".label")).find((el) => el.textContent === "a")!;
    await fireEvent.click(aLabel);
    await waitForRows();

    const nameInputs = Array.from(container.querySelectorAll(".add .name")) as HTMLInputElement[];
    expect(nameInputs.length).toBe(2);
    const [nestedInput, rootInput] = nameInputs;

    await fireEvent.focus(nestedInput);
    expect(container.querySelector(".suggest-list")).toBeNull(); // nested adder gets [] regardless of the root's fieldSuggestions
    await fireEvent.blur(nestedInput);

    await fireEvent.focus(rootInput);
    expect(container.querySelector(".suggest-list")).not.toBeNull(); // root adder still gets them
  });

  it("compact mode hides the find-field search box and expand/collapse-all button", () => {
    const { container, queryByPlaceholderText, queryByText } = render(TreeEditor, {
      props: { value: { a: 1 }, onchange: vi.fn(), onvalidchange: vi.fn(), compact: true },
    });
    expect(container.querySelector(".tree-toolbar")).toBeNull();
    expect(queryByPlaceholderText("Find field…")).toBeNull();
    expect(queryByText("Expand all")).toBeNull();
  });

  it("compact mode expands every container by default (no click needed)", () => {
    const doc = { a: { b: 1 }, c: 2 };
    const { container } = render(TreeEditor, {
      props: { value: doc, onchange: vi.fn(), onvalidchange: vi.fn(), compact: true },
    });
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toEqual(["a", "b", "c"]); // "b" visible without any click — "a" starts expanded
  });

  it("Expand all button opens every nested container at every depth", async () => {
    const doc = { address: { city: "Hue", geo: { lat: 1, lng: 2 } }, tags: ["a"] };
    const { container, getByText } = setup(doc);
    await fireEvent.click(getByText("Expand all"));
    await waitForRows();
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["address", "city", "geo", "lat", "lng", "tags", "0"]));
  });

  it("toggles to Collapse all after expanding, which closes everything back down", async () => {
    const doc = { address: { city: "Hue" } };
    const { container, getByText } = setup(doc);
    await fireEvent.click(getByText("Expand all"));
    await waitForRows();
    expect(container.querySelectorAll(".label").length).toBeGreaterThan(1);

    await fireEvent.click(getByText("Collapse all"));
    await waitForRows();
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toEqual(["address"]);
  });

  it("manually toggling a row after Expand all reverts the button back to 'Expand all'", async () => {
    const doc = { address: { city: "Hue" } };
    const { container, getByText } = setup(doc);
    await fireEvent.click(getByText("Expand all"));
    await tick();
    const addressLabel = Array.from(container.querySelectorAll(".label")).find((el) => el.textContent === "address")!;
    await fireEvent.click(addressLabel); // manually collapse just this one container
    await tick();
    expect(getByText("Expand all")).toBeTruthy();
  });

  describe("Find field search", () => {
    it("finds and reveals a nested field without expanding the rest of the tree", async () => {
      const doc = { name: "Ann", address: { city: "Hue", zip: "1000" }, other: { untouched: 1 } };
      const { container, getByPlaceholderText } = setup(doc);
      const input = getByPlaceholderText("Find field…");
      await fireEvent.input(input, { target: { value: "city" } });
      await waitForSearch();

      const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
      expect(labels).toContain("city"); // ancestor ("address") opened to reveal it
      expect(labels).not.toContain("untouched"); // unrelated branch left closed
      expect(container.querySelector(".tree-row-highlight .label")?.textContent).toBe("city");
      expect(getByPlaceholderText("Find field…").parentElement?.textContent).toContain("1/1");
    });

    it("Next cycles to the following match and updates the count", async () => {
      const doc = { a: { name: 1 }, b: { name: 2 } };
      const { getByPlaceholderText, getByLabelText, container } = setup(doc);
      await fireEvent.input(getByPlaceholderText("Find field…"), { target: { value: "name" } });
      await waitForSearch();
      expect(container.querySelector(".tree-row-highlight")?.textContent).toContain("a");

      await fireEvent.click(getByLabelText("Next match"));
      await tick();
      expect(container.querySelector(".tree-row-highlight")?.textContent).toContain("b");

      await fireEvent.click(getByLabelText("Next match")); // wraps back to the first match
      await tick();
      expect(container.querySelector(".tree-row-highlight")?.textContent).toContain("a");
    });

    it("shows 0/0 and no highlight when nothing matches", async () => {
      const { getByPlaceholderText, container } = setup({ name: "Ann" });
      await fireEvent.input(getByPlaceholderText("Find field…"), { target: { value: "zzz" } });
      await waitForSearch();
      expect(container.querySelector(".tree-search-count")?.textContent).toBe("0/0");
      expect(container.querySelector(".tree-row-highlight")).toBeNull();
    });

    it("clearing the query hides the match count", async () => {
      const { getByPlaceholderText, container } = setup({ name: "Ann" });
      const input = getByPlaceholderText("Find field…");
      await fireEvent.input(input, { target: { value: "name" } });
      await waitForSearch();
      expect(container.querySelector(".tree-search-count")).toBeTruthy();

      await fireEvent.input(input, { target: { value: "" } });
      await tick();
      expect(container.querySelector(".tree-search-count")).toBeNull();
    });
  });
});
