import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({ sampleDocuments: vi.fn(), countDocuments: vi.fn() }));
import * as docs from "../api/documents";
import { setSessionEnvironment } from "./sessionEnv";
import { createValidatorEditor } from "./validatorEditor.svelte";

const sample = docs.sampleDocuments as ReturnType<typeof vi.fn>;
const count = docs.countDocuments as ReturnType<typeof vi.fn>;

function make(json: string | null, save = vi.fn(async (..._a: unknown[]) => true)) {
  return { save, ed: createValidatorEditor({ sessionId: "s1", db: "d", coll: "c", validatorJson: json, level: "strict", action: "error", save }) };
}

describe("createValidatorEditor", () => {
  beforeEach(() => { vi.clearAllMocks(); setSessionEnvironment("s1", null); });

  it("parses the stored validator into the tree and keeps other operators", () => {
    const { ed } = make(JSON.stringify({ $jsonSchema: { bsonType: "object", properties: { a: { bsonType: "int" } } }, p: { $gt: 1 } }));
    expect(Object.keys(ed.root.properties)).toEqual(["a"]);
    expect(JSON.parse(ed.validatorJson)).toMatchObject({ p: { $gt: 1 } });
  });

  it("tree edit updates the JSON text", () => {
    const { ed } = make(null);
    ed.edit((r) => ({ ...r, bsonType: ["object"] }));
    ed.addField([], "email");
    expect(JSON.parse(ed.jsonText).$jsonSchema.properties.email.bsonType).toBe("string");
  });

  it("JSON edit updates the tree; invalid JSON keeps the tree and reports", () => {
    const { ed } = make(null);
    ed.setJsonText('{"$jsonSchema":{"bsonType":"object","required":["x"],"properties":{"x":{"bsonType":"int"}}}}');
    expect(ed.root.required).toEqual(["x"]);
    ed.setJsonText("{ nope");
    expect(ed.jsonError).toBeTruthy();
    expect(ed.root.required).toEqual(["x"]);
    ed.setJsonText("[1]");
    expect(ed.jsonError).toBeTruthy();
  });

  it("create from sample fills the tree", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "a".repeat(24) }, n: "x" }, { _id: { $oid: "b".repeat(24) }, n: "y" }]);
    const { ed } = make(null);
    await ed.createFromSample();
    expect(Object.keys(ed.root.properties)).toEqual(["_id", "n"]);
    expect(ed.root.required).toEqual(["_id", "n"]);
    expect(JSON.parse(ed.jsonText).$jsonSchema.bsonType).toBe("object");
  });

  it("test on data counts violators with the $nor filter", async () => {
    count.mockResolvedValue(7);
    const { ed } = make(JSON.stringify({ $jsonSchema: { bsonType: "object" } }));
    await ed.testOnData();
    expect(JSON.parse(count.mock.calls[0][3])).toEqual({ $nor: [{ $jsonSchema: { bsonType: "object" } }] });
    expect(ed.violators).toBe(7);
    expect(ed.violatorsStatement()).toContain(".limit(20)");
  });

  it("saves directly on non-PROD, through the gate on PROD, and not on invalid JSON", async () => {
    const a = make(null);
    a.ed.edit((r) => ({ ...r, bsonType: ["object"] }));
    await a.ed.requestSave();
    expect(a.save).toHaveBeenCalledTimes(1);

    setSessionEnvironment("s1", "prod");
    const b = make(null);
    b.ed.edit((r) => ({ ...r, bsonType: ["object"] }));
    await b.ed.requestSave();
    expect(b.save).not.toHaveBeenCalled();
    expect(b.ed.destructive.pending?.op).toBe("setValidator");
    await b.ed.destructive.confirm();
    expect(b.save).toHaveBeenCalledTimes(1);

    const c = make(null);
    c.ed.setJsonText("{");
    await c.ed.requestSave();
    expect(c.save).not.toHaveBeenCalled();
  });

  it("an empty tree saves {} (clears the validator)", async () => {
    const { ed, save } = make(JSON.stringify({ $jsonSchema: { bsonType: "object" } }));
    ed.setJsonText("{}");
    await ed.requestSave();
    expect(save).toHaveBeenCalledWith("{}", "strict", "error");
  });

  const STORED = JSON.stringify({
    $jsonSchema: {
      bsonType: ["object"], required: [], properties: { n: { bsonType: ["int"], minimum: { $numberLong: "9007199254740993" } }, o: { bsonType: "object", properties: {} } },
    },
  }, null, 2);

  it("saves a stored validator byte-identical when only the level changes", async () => {
    const { ed, save } = make(STORED);
    ed.level = "moderate";
    await ed.requestSave();
    expect(save).toHaveBeenCalledWith(STORED, "moderate", "error");
  });

  it("a JSON edit that does not change the value is not dirty", async () => {
    const { ed, save } = make(STORED);
    ed.setJsonText(JSON.stringify(JSON.parse(STORED)));
    expect(ed.dirty).toBe(false);
    await ed.requestSave();
    expect(save.mock.calls[0][0]).toBe(STORED);
  });

  it("editing one field keeps the $numberLong wrapper exact", async () => {
    const { ed, save } = make(STORED);
    ed.addField([], "extra");
    await ed.requestSave();
    const sent = save.mock.calls[0][0] as string;
    expect(sent).toContain('"$numberLong":"9007199254740993"');
    expect(JSON.parse(sent).$jsonSchema.properties.extra.bsonType).toBe("string");
  });

  it("tests violators against the whole validator, top-level operators included", async () => {
    count.mockResolvedValue(0);
    const v = { $jsonSchema: { bsonType: "object" }, price: { $gt: 0 } };
    const { ed } = make(JSON.stringify(v));
    await ed.testOnData();
    expect(JSON.parse(count.mock.calls[0][3])).toEqual({ $nor: [v] });
    expect(ed.violatorsStatement()).toContain("$gt");
  });

  it("an unreadable stored validator blocks Save and never sends {}", async () => {
    const { ed, save } = make("{ broken");
    expect(ed.loadError).toBeTruthy();
    await ed.requestSave();
    ed.addField([], "x");
    await ed.requestSave();
    expect(save).not.toHaveBeenCalled();
    ed.setJsonText('{"$jsonSchema":{"bsonType":"object"}}');
    expect(ed.loadError).toBeNull();
    await ed.requestSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a non-object $jsonSchema is not overwritten by tree edits, only by JSON", async () => {
    const { ed, save } = make('{"$jsonSchema":"oops","p":1}');
    expect(ed.locked).toBe(true);
    ed.addField([], "x");
    ed.update([], { bsonType: ["object"] });
    expect(ed.dirty).toBe(false);
    await ed.requestSave();
    expect(save.mock.calls[0][0]).toBe('{"$jsonSchema":"oops","p":1}');
    ed.setJsonText('{"$jsonSchema":{"bsonType":"object"}}');
    expect(ed.locked).toBe(false);
  });
});
