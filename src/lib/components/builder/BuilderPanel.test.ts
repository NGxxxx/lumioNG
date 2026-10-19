import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("../../api/documents", () => ({ aggregate: vi.fn(async () => [{ _id: 1, status: "a", total: 3 }]) }));
vi.mock("../../api/indexes", () => ({ listIndexes: vi.fn(async () => []) }));

import BuilderPanel from "./BuilderPanel.svelte";
import { createPipelineTree } from "../../stores/pipelineTree.svelte";

function setup(script: string) {
  const text = { v: script };
  const tree = createPipelineTree("conn:1", { get: () => text.v, set: (t) => { text.v = t; }, db: () => "shop", preview: { show: vi.fn(), clear: vi.fn() } });
  tree.syncFromScript();
  return { tree, text, ...render(BuilderPanel, { props: { tree } }) };
}

describe("BuilderPanel", () => {
  it("collapsed cards read as one line of words", () => {
    const { getByText } = setup('db.getCollection("orders").aggregate([{ "$group": { "_id": "$customer.tier", "count": { "$sum": 1 }, "sum_total": { "$sum": "$total" } } }])');
    expect(getByText("by customer.tier · count, sum(total)")).toBeTruthy();
  });

  it("the group form edits the stage and the script follows", async () => {
    vi.useFakeTimers();
    try {
      const { getByText, getByLabelText, text } = setup('db.getCollection("orders").aggregate([{ "$group": { "_id": null, "count": { "$sum": 1 } } }])');
      await fireEvent.click(getByText("all documents · count"));
      await fireEvent.click(getByLabelText(/All documents/));
      await fireEvent.input(getByLabelText("Group by 1"), { target: { value: "status" } });
      await vi.advanceTimersByTimeAsync(200);
      expect(JSON.parse(text.v.slice(text.v.indexOf("["), text.v.lastIndexOf("]") + 1))).toEqual([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a body the form can't represent is shown as Advanced JSON", async () => {
    const { getByText, container } = setup('db.getCollection("orders").aggregate([{ "$match": { "$expr": { "$gt": ["$a", 1] } } }])');
    expect(getByText("Advanced")).toBeTruthy();
    await fireEvent.click(container.querySelector(".summary")!);
    expect(container.querySelector(".json")).toBeTruthy();
  });

  it("a next-step chip after $group adds a sort on the first calculation", async () => {
    const { getByRole, tree } = setup('db.getCollection("orders").aggregate([{ "$group": { "_id": "$s", "count": { "$sum": 1 } } }])');
    await fireEvent.click(getByRole("button", { name: "Sort by count ↓" }));
    expect(tree.stages.map((s) => s.name)).toEqual(["$group", "$sort"]);
    expect(tree.stages[1].body).toEqual({ count: -1 });
  });

  it("the Top N template asks its questions and inserts three stages", async () => {
    const { getByRole, getByLabelText, tree } = setup('db.getCollection("orders").aggregate([])');
    await fireEvent.click(getByRole("button", { name: /Templates/ }));
    await fireEvent.click(getByRole("button", { name: "Top N by field" }));
    await fireEvent.input(getByLabelText("Field"), { target: { value: "status" } });
    await tick();
    await fireEvent.click(getByRole("button", { name: "Insert" }));
    expect(tree.stages.map((s) => s.name)).toEqual(["$group", "$sort", "$limit"]);
    expect(tree.stages[2].body).toBe(10);
  });

  it("disable and delete act on the card", async () => {
    const { getAllByRole, tree } = setup('db.getCollection("orders").aggregate([{ "$limit": 5 }, { "$skip": 1 }])');
    await fireEvent.click(getAllByRole("button", { name: "Disable stage" })[0]);
    expect(tree.stages[0].enabled).toBe(false);
    await fireEvent.click(getAllByRole("button", { name: "Delete stage" })[1]);
    expect(tree.stages.map((s) => s.name)).toEqual(["$limit"]);
  });

  it("Add stage inserts after the open card, and says so", async () => {
    const { getByRole, getByText, tree, container } = setup('db.getCollection("orders").aggregate([{ "$limit": 5 }, { "$skip": 1 }])');
    await fireEvent.click(getByText("5"));
    const add = getByRole("button", { name: "+ Add after stage 1" });
    const picker = container.querySelector(".bar select") as HTMLSelectElement;
    await fireEvent.change(picker, { target: { value: "$sample" } });
    await fireEvent.click(add);
    expect(tree.stages.map((s) => s.name)).toEqual(["$limit", "$sample", "$skip"]);
    expect(tree.selectedId).toBe(tree.stages[1].id);
  });

  it("the stage picker groups stages by purpose", () => {
    const { container } = setup('db.getCollection("orders").aggregate([])');
    const groups = [...container.querySelectorAll(".bar optgroup")].map((g) => g.getAttribute("label"));
    expect(groups).toEqual(["Filter & order", "Reshape", "Group & count", "Join", "Write output"]);
  });

  it("$sample and $unset open as forms", async () => {
    const { getByText, getByLabelText, queryByText } = setup('db.getCollection("orders").aggregate([{ "$sample": { "size": 7 } }, { "$unset": ["a", "b"] }])');
    expect(getByText("7 random")).toBeTruthy();
    expect(getByText("a, b")).toBeTruthy();
    expect(queryByText("Advanced")).toBeNull();
    await fireEvent.click(getByText("7 random"));
    expect((getByLabelText("Random documents") as HTMLInputElement).value).toBe("7");
  });

  it("Copy pipeline puts the enabled stages on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { getByRole } = setup('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 3 }])');
    await fireEvent.click(getByRole("button", { name: "Copy pipeline" }));
    expect(JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])).toEqual([{ $match: { a: 1 } }, { $limit: 3 }]);
  });
});
