import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/searchIndexes", () => ({
  atlasVersion: vi.fn(), listSearchIndexes: vi.fn(), createSearchIndex: vi.fn(), updateSearchIndex: vi.fn(), dropSearchIndex: vi.fn(),
}));
vi.mock("./commandLog.svelte", () => ({ commandLog: { pushTimed: vi.fn(async (_c: string, _s: string, fn: () => Promise<unknown>) => fn()) } }));

import * as api from "../api/searchIndexes";
import { setSessionEnvironment } from "./sessionEnv";
import { atlasDetect } from "./atlasDetect";
import { createSearchIndexView } from "./searchIndexView.svelte";

const list = vi.mocked(api.listSearchIndexes);
const doc = (o: object) => JSON.stringify(o);

beforeEach(() => {
  vi.clearAllMocks();
  setSessionEnvironment("s1", null);
  atlasDetect.invalidate("s1");
});

describe("Atlas detection", () => {
  it("a *.mongodb.net host is Atlas without probing", async () => {
    const v = createSearchIndexView("s1", "d", "c", "mongodb+srv://u:p@c0.ab.mongodb.net/");
    expect(v.isAtlas).toBe(true);
    await v.detect();
    expect(api.atlasVersion).not.toHaveBeenCalled();
  });
  it("another host is probed with atlasVersion", async () => {
    vi.mocked(api.atlasVersion).mockResolvedValueOnce("v20240101");
    const v = createSearchIndexView("s1", "d", "c", "mongodb://localhost:27019/?directConnection=true");
    expect(v.isAtlas).toBe(false);
    expect(await v.detect()).toBe(true);
    expect(v.isAtlas).toBe(true);
  });
  it("the answer is cached per session until it is invalidated (reconnect)", async () => {
    vi.mocked(api.atlasVersion).mockResolvedValue(null);
    await createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017").detect();
    const again = createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017");
    expect(await again.detect()).toBe(false);
    expect(api.atlasVersion).toHaveBeenCalledTimes(1);
    atlasDetect.invalidate("s1");
    vi.mocked(api.atlasVersion).mockResolvedValue("v1");
    expect(await createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017").detect()).toBe(true);
    expect(api.atlasVersion).toHaveBeenCalledTimes(2);
    expect(createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017").isAtlas).toBe(true);
  });
  it("a plain server, or a probe that throws, is not Atlas", async () => {
    vi.mocked(api.atlasVersion).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("boom"));
    const v = createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017");
    expect(await v.detect()).toBe(false);
    expect(await v.detect()).toBe(false);
  });
});

describe("listing", () => {
  it("loads once and parses the rows", async () => {
    list.mockResolvedValue([doc({ name: "default", type: "search", status: "READY", queryable: true, latestDefinition: { mappings: { dynamic: true } } })]);
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    await v.load();
    await v.load();
    expect(list).toHaveBeenCalledTimes(1);
    expect(v.rows.map((r) => r.name)).toEqual(["default"]);
    expect(v.unsupported).toBe(false);
  });
  it("a server without search support is reported, not shown as an error", async () => {
    list.mockRejectedValue({ kind: "Query", message: "Using Atlas Search Database Commands and the $listSearchIndexes aggregation stage requires additional configuration." });
    const v = createSearchIndexView("s1", "d", "c", "mongodb://localhost:27017");
    await v.load();
    expect(v.unsupported).toBe(true);
    expect(v.error).toBeNull();
    expect(v.rows).toEqual([]);
  });
  it("any other failure is an error", async () => {
    list.mockRejectedValue({ kind: "Query", message: "not authorized on d to execute command" });
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    await v.load();
    expect(v.unsupported).toBe(false);
    expect(v.error).toContain("missing privilege");
  });
});

describe("editing", () => {
  it("create starts from a template and sends compact JSON", async () => {
    list.mockResolvedValue([]);
    vi.mocked(api.createSearchIndex).mockResolvedValue("default");
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.openCreate("vector");
    expect(v.editor?.type).toBe("vectorSearch");
    v.setName("  vec ");
    await v.requestSave();
    expect(api.createSearchIndex).toHaveBeenCalledWith("s1", "d", "c", "vec", "vectorSearch", expect.stringMatching(/^\{"fields":\[\{/));
    expect(v.editor).toBeNull();
    expect(list).toHaveBeenCalled();
  });
  it("an invalid definition is flagged and nothing is sent", async () => {
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.openCreate();
    v.setDefinition("{ nope");
    await v.requestSave();
    expect(v.problem).toBe("json");
    expect(api.createSearchIndex).not.toHaveBeenCalled();
    expect(v.editor).not.toBeNull();
  });
  it("edit keeps the name and type and calls update", async () => {
    list.mockResolvedValue([doc({ name: "vec", type: "vectorSearch", latestDefinition: { fields: [{ type: "vector", path: "e", numDimensions: 2, similarity: "cosine" }] } })]);
    vi.mocked(api.updateSearchIndex).mockResolvedValue();
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    await v.load();
    v.openEdit("vec");
    expect(v.editor).toMatchObject({ mode: "edit", name: "vec", type: "vectorSearch" });
    await v.requestSave();
    expect(api.updateSearchIndex).toHaveBeenCalledWith("s1", "d", "c", "vec", expect.stringContaining('"numDimensions":2'));
  });
  it("a failing server call leaves the editor open with the error", async () => {
    vi.mocked(api.createSearchIndex).mockRejectedValue({ kind: "Query", message: "Index already exists" });
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.openCreate();
    await v.requestSave();
    expect(v.editor).not.toBeNull();
    expect(v.error).toContain("already exists");
  });
});

describe("destructive gate", () => {
  it("create / update go straight through off PROD", async () => {
    vi.mocked(api.createSearchIndex).mockResolvedValue("x");
    list.mockResolvedValue([]);
    setSessionEnvironment("s1", "dev");
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.openCreate();
    await v.requestSave();
    expect(v.destructive.pending).toBeNull();
    expect(api.createSearchIndex).toHaveBeenCalled();
  });
  it("on PROD, create waits for the confirmation", async () => {
    vi.mocked(api.createSearchIndex).mockResolvedValue("x");
    list.mockResolvedValue([]);
    setSessionEnvironment("s1", "prod");
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.openCreate();
    await v.requestSave();
    expect(api.createSearchIndex).not.toHaveBeenCalled();
    expect(v.destructive.pending).toMatchObject({ op: "searchIndexWrite", level: "confirm", env: "prod" });
    await v.destructive.confirm();
    expect(api.createSearchIndex).toHaveBeenCalledTimes(1);
  });
  it("drop always needs the index name typed, then drops and reloads", async () => {
    vi.mocked(api.dropSearchIndex).mockResolvedValue();
    list.mockResolvedValue([]);
    const v = createSearchIndexView("s1", "d", "c", "mongodb://x.mongodb.net");
    v.requestDrop("old");
    await vi.waitFor(() => expect(v.destructive.pending).not.toBeNull());
    expect(v.destructive.pending).toMatchObject({ op: "dropIndex", level: "type", target: { index: "old" } });
    expect(api.dropSearchIndex).not.toHaveBeenCalled();
    await v.destructive.confirm();
    expect(api.dropSearchIndex).toHaveBeenCalledWith("s1", "d", "c", "old");
  });
});
