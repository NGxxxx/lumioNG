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
    await tick();
    const labels = Array.from(container.querySelectorAll(".label")).map((el) => el.textContent);
    expect(labels).toContain("city");
    expect(labels).toContain("zip");
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
});
