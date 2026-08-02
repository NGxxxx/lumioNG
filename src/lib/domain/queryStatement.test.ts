import { describe, it, expect } from "vitest";
import { methodHeadAt, aggregateTemplate } from "./queryStatement";

describe("aggregateTemplate", () => {
  it("seeds a getCollection().aggregate template", () => {
    expect(aggregateTemplate("movies")).toBe('db.getCollection("movies").aggregate([\n  { "$match": {} }\n])');
  });
  it("handles an empty collection name", () => {
    expect(aggregateTemplate("")).toContain('db.getCollection("").aggregate(');
  });
});

describe("methodHeadAt", () => {
  it("returns method, coll, and the index of its opening paren", () => {
    const text = 'db.c.find({ "a": 1 })';
    const h = methodHeadAt(text, text.length);
    expect(h).not.toBeNull();
    expect(h!.method).toBe("find");
    expect(h!.coll).toBe("c");
    expect(text[h!.argOpen]).toBe("(");
    expect(h!.start).toBe(0);
  });
  it("resolves the collection through getCollection(\"…\")", () => {
    const t = 'db.getCollection("movies").aggregate([{ "$ma';
    const h = methodHeadAt(t, t.length);
    expect(h!.method).toBe("aggregate");
    expect(h!.coll).toBe("movies");
  });
  it("selects the statement governing the cursor in a multi-statement document", () => {
    const text = 'db.a.find({})\ndb.b.aggregate([{ "$ma" }])';
    const pos = text.indexOf("$ma");
    const h = methodHeadAt(text, pos);
    expect(h!.method).toBe("aggregate");
    expect(h!.coll).toBe("b");
  });
  it("returns null before any method call and for non-statements", () => {
    expect(methodHeadAt("db.c.", 5)).toBeNull();
    expect(methodHeadAt("not a statement", 5)).toBeNull();
  });
  it("resolves coll/method/start through a getSiblingDB(...).getCollection(...) chain", () => {
    const t = 'db.getSiblingDB("o").getCollection("c").aggregate([{ "$ma';
    const h = methodHeadAt(t, t.length);
    expect(h!.method).toBe("aggregate");
    expect(h!.coll).toBe("c");
    expect(h!.start).toBe(0); // the whole chain, including the getSiblingDB(...) hop, is one match
  });
});
