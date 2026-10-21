import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/connection", () => ({ listPlainCollections: vi.fn() }));
vi.mock("../api/files", () => ({ saveDialog: vi.fn(), writeTextFile: vi.fn(), writeBase64File: vi.fn() }));
vi.mock("../api/documents", () => ({ sampleDocuments: vi.fn(), queryPage: vi.fn() }));
import * as conn from "../api/connection";
import * as docs from "../api/documents";
import * as files from "../api/files";
import { createDbDiagram, DIAGRAM_MAX_COLLECTIONS } from "./dbDiagram.svelte";
import { prefs } from "./prefs.svelte";
import { getRemembered } from "./refMemory";

const list = conn.listPlainCollections as ReturnType<typeof vi.fn>;
const sample = docs.sampleDocuments as ReturnType<typeof vi.fn>;
const page = docs.queryPage as ReturnType<typeof vi.fn>;
const oid = (n: number) => ({ $oid: n.toString(16).padStart(24, "0") });

function setup(foundOf: (ids: unknown[]) => number) {
  list.mockResolvedValue(["orders", "users", "system.views"]);
  sample.mockImplementation(async (_s: string, _d: string, c: string) =>
    c === "orders" ? [1, 2, 3, 4, 5].map((i) => ({ _id: oid(i), userId: oid(100 + i) })) : [{ _id: oid(101) }],
  );
  page.mockImplementation(async (_s: string, _d: string, _c: string, _skip: number, limit: number, filter: string) => {
    const ids = JSON.parse(filter)._id.$in as unknown[];
    return Array.from({ length: Math.min(foundOf(ids), limit) }, (_, i) => ({ _id: ids[i] }));
  });
}

describe("createDbDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs.clear();
  });

  it("keeps a candidate whose sampled values mostly exist in the target, with a read-only lookup", async () => {
    setup((ids) => ids.length);
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    expect(d.edges.map((e) => [e.id, e.score])).toEqual([["orders.userId->users", 1]]);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0].slice(1, 4)).toEqual(["shop", "users", 0]);
    expect(sample.mock.calls.every((c) => c[4] === 200 && c[2] !== "system.views")).toBe(true);
    expect(d.nodes.map((n) => n.name).sort()).toEqual(["orders", "users"]);
    expect(d.running).toBe(false);
  });

  it("drops weak candidates (< 0.8)", async () => {
    setup((ids) => Math.floor(ids.length / 2));
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    expect(d.edges).toEqual([]);
  });

  it("limits a run to 50 collections and says so", async () => {
    list.mockResolvedValue(Array.from({ length: 60 }, (_, i) => `c${i}`));
    sample.mockResolvedValue([]);
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    expect(sample).toHaveBeenCalledTimes(DIAGRAM_MAX_COLLECTIONS);
    expect(d.truncated).toBe(true);
  });

  it("can be cancelled between collections", async () => {
    list.mockResolvedValue(["a", "b", "c"]);
    const d = createDbDiagram("s", "shop", 1);
    sample.mockImplementation(async () => {
      d.cancel();
      return [];
    });
    await d.start();
    expect(sample).toHaveBeenCalledTimes(1);
    expect(d.running).toBe(false);
    expect(d.finished).toBe(false);
  });

  it("a failing collection does not stop the run", async () => {
    setup((ids) => ids.length);
    sample.mockImplementation(async (_s: string, _d: string, c: string) => {
      if (c === "users") throw new Error("no privilege");
      return [{ _id: oid(1), userId: oid(101) }];
    });
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    expect(d.failed).toContain("users");
    expect(d.finished).toBe(true);
  });

  it("remembers confirmations and removals across runs, and feeds the reference jump", async () => {
    setup((ids) => ids.length);
    const d = createDbDiagram("s", "shop", 7);
    await d.start();
    d.confirm("orders.userId->users");
    expect(getRemembered("7|shop|orders|userId")).toBe("users");
    const again = createDbDiagram("s", "shop", 7);
    await again.start();
    expect(again.edges[0].confirmed).toBe(true);

    again.remove("orders.userId->users");
    expect(again.edges).toEqual([]);
    expect(getRemembered("7|shop|orders|userId")).toBeNull();
    const third = createDbDiagram("s", "shop", 7);
    await third.start();
    expect(third.edges).toEqual([]);
    expect(third.removed).toHaveLength(1);
    third.restore("orders.userId->users");
    expect(third.edges).toHaveLength(1);
  });

  it("dragging a node keeps its position", async () => {
    setup((ids) => ids.length);
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    d.moveNode("users", 500, 300);
    d.confirm("orders.userId->users");
    expect(d.nodes.find((n) => n.name === "users")).toMatchObject({ x: 500, y: 300 });
  });

  it("filters the target by the sampled ids, and exports through the save dialog", async () => {
    setup((ids) => ids.length);
    const d = createDbDiagram("s", "shop", 1);
    await d.start();
    expect(JSON.parse(d.filterFor("orders.userId->users")!)._id.$in).toHaveLength(5);

    const save = files.saveDialog as ReturnType<typeof vi.fn>;
    save.mockResolvedValueOnce(null).mockResolvedValue("/tmp/x.svg");
    expect(await d.exportSvg()).toBe(false);
    expect(files.writeTextFile).not.toHaveBeenCalled();
    expect(await d.exportSvg()).toBe(true);
    expect((files.writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain("<svg");
    expect(await d.savePng("aGk=")).toBe(true);
    expect(files.writeBase64File).toHaveBeenCalledWith("/tmp/x.svg", "aGk=");
  });
});
