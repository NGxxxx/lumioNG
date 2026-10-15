import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ExplainPane from "./ExplainPane.svelte";
import type { ExplainSummary } from "../domain/explainPlan";

const collscan: ExplainSummary = {
  verdict: "collscan", indexName: null,
  stages: [{ name: "COLLSCAN", nReturned: 42, docsExamined: 10000, keysExamined: null, executionTimeMs: 10 }],
  totalTimeMs: 12, totalDocsExamined: 10000, totalDocsReturned: 42,
};

const ixscan: ExplainSummary = {
  verdict: "ixscan", indexName: "status_1",
  stages: [{ name: "IXSCAN", nReturned: 42, docsExamined: 42, keysExamined: 42, executionTimeMs: 1 }],
  totalTimeMs: 2, totalDocsExamined: 42, totalDocsReturned: 42,
};

const base = {
  summary: null, prevSummary: null, rawJson: null, loading: false,
  suggestion: null, coll: "orders", oncreateindex: vi.fn(), onrefresh: vi.fn(),
};

describe("ExplainPane", () => {
  it("shows the loading status while loading", () => {
    const { getByText } = render(ExplainPane, { props: { ...base, loading: true } });
    expect(getByText("Running explain…")).toBeTruthy();
  });

  it("shows the collscan warning banner and the stage table", () => {
    const { getByText } = render(ExplainPane, { props: { ...base, summary: collscan } });
    expect(getByText(/Collection scan/i)).toBeTruthy();
    expect(getByText("COLLSCAN")).toBeTruthy();
  });

  it("shows the index-used banner with the index name", () => {
    const { getByText } = render(ExplainPane, { props: { ...base, summary: ixscan } });
    expect(getByText(/status_1/)).toBeTruthy();
  });

  it("shows the suggested-index block for a collscan with a suggestion", () => {
    const suggestion = { keys: { status: 1 as const }, snippet: 'db.getCollection("orders").createIndex({"status":1})' };
    const { getByText } = render(ExplainPane, {
      props: { ...base, summary: collscan, suggestion },
    });
    expect(getByText(suggestion.snippet)).toBeTruthy();
    expect(getByText("Create index")).toBeTruthy();
  });

  it("omits the suggested-index block when there is no suggestion", () => {
    const { queryByText } = render(ExplainPane, {
      props: { ...base, summary: ixscan, suggestion: null },
    });
    expect(queryByText("Create index")).toBeNull();
  });

  it("clicking Create index opens a confirm dialog, then calls oncreateindex on confirm", async () => {
    const oncreateindex = vi.fn();
    const suggestion = { keys: { status: 1 as const }, snippet: 'db.getCollection("orders").createIndex({"status":1})' };
    const { getByText } = render(ExplainPane, {
      props: { ...base, summary: collscan, suggestion, oncreateindex },
    });
    await fireEvent.click(getByText("Create index"));
    expect(getByText("Create index?")).toBeTruthy();
    await fireEvent.click(getByText("OK"));
    expect(oncreateindex).toHaveBeenCalled();
  });

  it("shows a before/after comparison only when prevSummary is set", () => {
    const { getByText } = render(ExplainPane, {
      props: { ...base, summary: ixscan, prevSummary: collscan },
    });
    expect(getByText("Before")).toBeTruthy();
    expect(getByText("After")).toBeTruthy();
  });

  it("calls onrefresh when the Refresh button is clicked", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(ExplainPane, { props: { ...base, summary: ixscan, onrefresh } });
    await fireEvent.click(getByText("Refresh"));
    expect(onrefresh).toHaveBeenCalled();
  });

  it("shows the efficiency sentence and the flow with numbers", () => {
    const { getByText } = render(ExplainPane, { props: { ...base, summary: collscan } });
    expect(getByText("Read 10,000 to return 42 — 0.4%")).toBeTruthy();
    expect(getByText("docs 10,000")).toBeTruthy();
    expect(getByText("→ 42 returned")).toBeTruthy();
  });

  it("pipeline advice: move $match first runs the action", async () => {
    const onmovematchfirst = vi.fn();
    const { getByRole } = render(ExplainPane, {
      props: { ...base, summary: ixscan, pipeline: [{ name: "$group", body: {} }, { name: "$match", body: {} }], onmovematchfirst },
    });
    await fireEvent.click(getByRole("button", { name: "Move $match first" }));
    expect(onmovematchfirst).toHaveBeenCalled();
  });

  it("on PROD the create-index confirmation says so", async () => {
    const suggestion = { keys: { status: 1 as const }, snippet: 'db.getCollection("orders").createIndex({"status":1})' };
    const { getByRole, getByText } = render(ExplainPane, { props: { ...base, summary: collscan, suggestion, prod: true } });
    await fireEvent.click(getByRole("button", { name: "Create index" }));
    expect(getByText(/This creates the index on PROD/)).toBeTruthy();
  });
});
