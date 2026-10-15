import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import FilterChips from "./FilterChips.svelte";
import type { Chip } from "../domain/filterChips";
import type { FieldInfo } from "../domain/fieldInfo";

const fields: FieldInfo[] = [
  { path: "status", type: "string", presence: 1, indexed: true },
  { path: "total", type: "number", presence: 0.9, indexed: false },
];

function setup(chips: Chip[] = [], over: Record<string, unknown> = {}) {
  const props = {
    chips, fields, valuesFor: (p: string) => (p === "status" ? ['"shipped"', '"pending"'] : []),
    slowHint: (p: string) => p === "total", zero: false, history: [],
    onchange: vi.fn(), onhistory: vi.fn(), onpin: vi.fn(), onclearhistory: vi.fn(), ...over,
  };
  return { props, ...render(FilterChips, { props }) };
}

describe("FilterChips", () => {
  it("offers 'or' between two is-chips on one field and joins them into one list", async () => {
    const two: Chip[] = [{ field: "status", op: "eq", values: ['"a"'] }, { field: "status", op: "eq", values: ['"b"'] }];
    const { getByRole, props } = setup(two);
    await fireEvent.click(getByRole("button", { name: "or" }));
    expect(props.onchange).toHaveBeenCalledWith([{ field: "status", op: "in", values: ['"a"', '"b"'] }]);
  });

  it("no 'or' between chips on different fields", () => {
    const { queryByRole } = setup([{ field: "status", op: "eq", values: ['"a"'] }, { field: "total", op: "eq", values: ["1"] }]);
    expect(queryByRole("button", { name: "or" })).toBeNull();
  });

  it("quick syntax uses the field's type (digits on a string field stay text)", async () => {
    const { getByLabelText, props } = setup();
    const input = getByLabelText("+ Condition");
    await fireEvent.input(input, { target: { value: "status:42" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onchange).toHaveBeenLastCalledWith([{ field: "status", op: "eq", values: ['"42"'] }]);
  });

  it("renders chips in words and removes one with ×", async () => {
    const { getByText, getAllByRole, props } = setup([{ field: "status", op: "eq", values: ['"shipped"'] }, { field: "total", op: "gt", values: ["100"] }]);
    expect(getByText("is")).toBeTruthy();
    expect(getByText("shipped")).toBeTruthy();
    await fireEvent.click(getAllByRole("button", { name: "Remove condition" })[0]);
    expect(props.onchange).toHaveBeenCalledWith([{ field: "total", op: "gt", values: ["100"] }]);
  });

  it("quick syntax adds a chip on Enter; Backspace on empty removes the last", async () => {
    const { getByLabelText, props } = setup([{ field: "status", op: "eq", values: ['"a"'] }]);
    const input = getByLabelText("+ Condition");
    await fireEvent.input(input, { target: { value: "total>100" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onchange).toHaveBeenLastCalledWith([{ field: "status", op: "eq", values: ['"a"'] }, { field: "total", op: "gt", values: ["100"] }]);
    await fireEvent.input(input, { target: { value: "" } });
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(props.onchange).toHaveBeenLastCalledWith([]);
  });

  it("the editor builds a condition: field → operator → value", async () => {
    const { getByLabelText, getByRole, getByText, props } = setup();
    await fireEvent.keyDown(getByLabelText("+ Condition"), { key: "Enter" });
    await fireEvent.mouseDown(getByText("status"));
    await fireEvent.input(getByRole("dialog").querySelectorAll("input")[1], { target: { value: "shipped" } });
    await fireEvent.click(getByRole("button", { name: "Apply" }));
    expect(props.onchange).toHaveBeenCalledWith([{ field: "status", op: "eq", values: ['"shipped"'] }]);
  });

  it("editing an 'in' chip without touching the list keeps every original value", async () => {
    const chip: Chip = { field: "status", op: "in", values: ['"a, b"', '"c"'] };
    const { getByText, getByRole, props } = setup([chip]);
    await fireEvent.click(getByText("status").closest("button")!);
    await fireEvent.click(getByRole("button", { name: "Apply" }));
    expect(props.onchange).toHaveBeenCalledWith([chip]);
  });

  it("editing a range with a $lt end keeps it exclusive", async () => {
    const chip: Chip = { field: "total", op: "between", values: ["18", "65"], upperExclusive: true };
    const { getByText, getByRole, props } = setup([chip]);
    await fireEvent.click(getByText("total").closest("button")!);
    await fireEvent.click(getByRole("button", { name: "Apply" }));
    expect(props.onchange).toHaveBeenCalledWith([chip]);
  });

  it("an invalid typed value for a number field is refused", async () => {
    const { getByLabelText, getByRole, getByText, props } = setup();
    await fireEvent.keyDown(getByLabelText("+ Condition"), { key: "Enter" });
    await fireEvent.mouseDown(getByText("total"));
    await fireEvent.input(getByRole("dialog").querySelectorAll("input")[1], { target: { value: "lots" } });
    await fireEvent.click(getByRole("button", { name: "Apply" }));
    expect(props.onchange).not.toHaveBeenCalled();
    expect(getByText(/valid value/)).toBeTruthy();
  });

  it("shows the zero-result note and the slow-field dot", () => {
    const { getByText, getByLabelText } = setup([{ field: "total", op: "gt", values: ["1"] }], { zero: true });
    expect(getByText(/No documents match/)).toBeTruthy();
    expect(getByLabelText(/may be slow/)).toBeTruthy();
  });

  it("recent filters re-apply on click", async () => {
    const { getByRole, getByText, props } = setup([], { history: [{ text: '{"status": "shipped"}', at: Date.now(), pinned: false }] });
    await fireEvent.click(getByRole("button", { name: "Recent filters" }));
    await fireEvent.click(getByText(/status is shipped/));
    expect(props.onhistory).toHaveBeenCalledWith('{"status": "shipped"}');
  });
});
