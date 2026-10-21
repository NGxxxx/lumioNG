import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("../api/searchIndexes", () => ({
  atlasVersion: vi.fn(), listSearchIndexes: vi.fn(async () => []), createSearchIndex: vi.fn(async () => "default"), updateSearchIndex: vi.fn(), dropSearchIndex: vi.fn(),
}));
vi.mock("../stores/commandLog.svelte", () => ({ commandLog: { pushTimed: vi.fn(async (_c: string, _s: string, fn: () => Promise<unknown>) => fn()) } }));

import * as api from "../api/searchIndexes";
import { createSearchIndexView } from "../stores/searchIndexView.svelte";
import SearchIndexPanel from "./SearchIndexPanel.svelte";

beforeEach(() => vi.clearAllMocks());

describe("SearchIndexPanel", () => {
  it("creates a vector index from the template", async () => {
    const view = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    const { getByText, getByLabelText } = render(SearchIndexPanel, { props: { view } });
    await waitFor(() => expect(view.loaded).toBe(true));
    await fireEvent.click(getByText("Create search index"));
    await fireEvent.change(getByLabelText("Template"), { target: { value: "vector" } });
    expect(view.editor?.type).toBe("vectorSearch");
    await fireEvent.click(getByText("Save"));
    await waitFor(() => expect(api.createSearchIndex).toHaveBeenCalledWith("s1", "d", "c", null, "vectorSearch", expect.stringContaining('"numDimensions":1536')));
  });

  it("shows the problem and sends nothing for an invalid definition", async () => {
    const view = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    const { getByText, findByRole } = render(SearchIndexPanel, { props: { view } });
    await waitFor(() => expect(view.loaded).toBe(true));
    await fireEvent.click(getByText("Create search index"));
    view.setDefinition("{");
    await fireEvent.click(getByText("Save"));
    expect((await findByRole("alert")).textContent).toMatch(/not valid JSON/);
    expect(api.createSearchIndex).not.toHaveBeenCalled();
  });

  it("hides write actions on a read-only session and when the server does not support search", async () => {
    vi.mocked(api.listSearchIndexes).mockRejectedValueOnce({ kind: "Query", message: "$listSearchIndexes stage is only allowed on MongoDB Atlas" });
    const view = createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017");
    const { queryByText, findByRole } = render(SearchIndexPanel, { props: { view, readOnly: true } });
    expect((await findByRole("status")).textContent).toMatch(/does not support Atlas Search/);
    expect(queryByText("Create search index")).toBeNull();
  });

  it("shows no Create, Edit or Drop buttons on a read-only session, but still lists the indexes", async () => {
    vi.mocked(api.listSearchIndexes).mockResolvedValueOnce([JSON.stringify({ name: "default", type: "search", status: "READY", queryable: true, latestDefinition: { mappings: { dynamic: true } } })]);
    const view = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    const { findByText, queryByText } = render(SearchIndexPanel, { props: { view, readOnly: true } });
    await findByText("default");
    for (const label of ["Create search index", "Edit", "Drop"]) expect(queryByText(label)).toBeNull();
  });
});
