import { describe, expect, it } from "vitest";
import { STAGE_CODECS } from "./index";
import { deepEqualOrdered } from "./deepEqualOrdered";

function roundTrip(name: string, body: unknown) {
  const c = STAGE_CODECS[name];
  const m = c.parse(body);
  expect(m).not.toBeNull();
  expect(deepEqualOrdered(c.build(m), body)).toBe(true);
  return m;
}
const rejects = (name: string, body: unknown) => expect(STAGE_CODECS[name].parse(body)).toBeNull();

describe("$group", () => {
  it("round-trips all shapes", () => {
    expect(roundTrip("$group", { _id: null, n: { $sum: 1 } })).toEqual({
      by: null, accumulators: [{ name: "n", op: "count" }],
    });
    expect(roundTrip("$group", { _id: "$customer.tier", count: { $sum: 1 }, total: { $sum: "$total" } })).toEqual({
      by: ["customer.tier"],
      accumulators: [{ name: "count", op: "count" }, { name: "total", op: "sum", field: "total" }],
    });
    roundTrip("$group", { _id: { a: "$a", tier: "$customer.tier" }, x: { $avg: "$x" } });
    for (const op of ["$avg", "$min", "$max", "$first", "$last", "$push", "$addToSet"]) {
      roundTrip("$group", { _id: "$k", v: { [op]: "$f" } });
    }
    roundTrip("$group", { _id: null });
  });
  it("rejects what it cannot represent", () => {
    rejects("$group", { _id: "$k", v: { $sum: { $multiply: ["$a", "$b"] } } });
    rejects("$group", { _id: "$k", v: { $sum: 2 } });
    rejects("$group", { _id: "$k", v: { $count: {} } });
    rejects("$group", { _id: "$k", v: { $stdDevPop: "$a" } });
    rejects("$group", { _id: "$k", v: { $sum: "$a", $max: "$a" } });
    rejects("$group", { _id: "$k", v: 1 });
    rejects("$group", { _id: { a: "$b" } }); // key != last segment
    rejects("$group", { _id: { a: "$a" } }); // single-key object would rebuild as "$a"
    rejects("$group", { _id: { a: "$a", b: { $year: "$d" } } });
    rejects("$group", { _id: "$$ROOT" });
    rejects("$group", { _id: "x" });
    rejects("$group", { n: { $sum: 1 }, _id: null }); // _id not first
    rejects("$group", { n: { $sum: 1 } });
    rejects("$group", "x");
  });
  it("summaries", () => {
    const s = (b: unknown) => STAGE_CODECS["$group"].summarize(STAGE_CODECS["$group"].parse(b));
    expect(s({ _id: "$customer.tier", count: { $sum: 1 }, t: { $sum: "$total" } })).toBe("by customer.tier · count, sum(total)");
    expect(s({ _id: null, c: { $sum: 1 } })).toBe("all documents · count");
    expect(s({ _id: { a: "$a", b: "$b" }, m: { $max: "$x" } })).toBe("by a, b · max(x)");
  });
});

describe("$sort", () => {
  it("round-trips and summarizes", () => {
    const m = roundTrip("$sort", { total: -1, name: 1 });
    expect(m).toEqual([{ field: "total", dir: -1 }, { field: "name", dir: 1 }]);
    expect(STAGE_CODECS["$sort"].summarize(m)).toBe("total ↓, name ↑");
  });
  it("rejects", () => {
    rejects("$sort", { score: { $meta: "textScore" } });
    rejects("$sort", { a: 2 });
    rejects("$sort", { a: true });
    rejects("$sort", {});
    rejects("$sort", [1]);
  });
});

describe("$project / $addFields / $set", () => {
  it("$project modes round-trip with key order", () => {
    const body = { a: 1, b: 1, c: 0, x: "$y", z: { $add: ["$p", 1] }, lit: "hi", t: true };
    const m = roundTrip("$project", body);
    expect(m).toEqual([
      { field: "a", mode: "include" },
      { field: "b", mode: "include" },
      { field: "c", mode: "exclude" },
      { field: "x", mode: "rename", value: "y" },
      { field: "z", mode: "expr", value: '{"$add":["$p",1]}' },
      { field: "lit", mode: "expr", value: '"hi"' },
      { field: "t", mode: "expr", value: "true" }, // true stays expr so build() is byte-identical
    ]);
    expect(STAGE_CODECS["$project"].summarize(m)).toBe(
      "keep a, b · drop c · rename y→x · compute z, lit, t",
    );
  });
  it("summary only lists present parts", () => {
    const c = STAGE_CODECS["$project"];
    expect(c.summarize(c.parse({ a: 1 }))).toBe("keep a");
    expect(c.summarize(c.parse({ n: "$m" }))).toBe("rename m→n");
  });
  it("$addFields/$set have no include/exclude", () => {
    for (const n of ["$addFields", "$set"]) {
      expect(roundTrip(n, { a: 1, b: 0, c: "$d" })).toEqual([
        { field: "a", mode: "expr", value: "1" },
        { field: "b", mode: "expr", value: "0" },
        { field: "c", mode: "rename", value: "d" },
      ]);
    }
  });
  it("rejects nested objects, empties, bad", () => {
    rejects("$project", { a: { b: 1 } });
    rejects("$project", { a: {} });
    rejects("$addFields", { a: { b: "$c" } });
    rejects("$project", {});
    rejects("$project", [1]);
  });
  it("an operator object with nested plain object inside is fine", () => {
    roundTrip("$addFields", { a: { $cond: [{ $gt: ["$x", 1] }, { k: 1 }, null] } });
  });
});

describe("$limit / $skip / $count", () => {
  it("round-trip", () => {
    expect(roundTrip("$limit", 10)).toBe(10);
    expect(roundTrip("$skip", 0)).toBe(0);
    expect(STAGE_CODECS["$limit"].summarize(10)).toBe("10");
    expect(STAGE_CODECS["$skip"].summarize(20)).toBe("20");
    expect(roundTrip("$count", "n")).toBe("n");
    expect(STAGE_CODECS["$count"].summarize("n")).toBe("as n");
  });
  it("rejects", () => {
    for (const v of [-1, 1.5, "10", null, NaN, { $numberLong: "1" }]) {
      rejects("$limit", v);
      rejects("$skip", v);
    }
    rejects("$count", "");
    rejects("$count", 3);
  });
});

describe("$unwind", () => {
  it("string form", () => {
    expect(roundTrip("$unwind", "$items")).toEqual({ path: "items", preserve: false });
    expect(STAGE_CODECS["$unwind"].summarize({ path: "items", preserve: false })).toBe("items");
  });
  it("object form with preserve", () => {
    const m = roundTrip("$unwind", { path: "$items", preserveNullAndEmptyArrays: true });
    expect(m).toEqual({ path: "items", preserve: true });
    expect(STAGE_CODECS["$unwind"].summarize(m)).toBe("items (keep empty)");
  });
  it("build of preserve:false is the string form", () => {
    expect(STAGE_CODECS["$unwind"].build({ path: "a", preserve: false })).toBe("$a");
  });
  it("rejects", () => {
    rejects("$unwind", { path: "$a", includeArrayIndex: "i" });
    rejects("$unwind", { path: "$a", preserveNullAndEmptyArrays: true, includeArrayIndex: "i" });
    rejects("$unwind", { path: "$a", preserveNullAndEmptyArrays: false }); // would rebuild as string
    rejects("$unwind", { path: "$a" });
    rejects("$unwind", { preserveNullAndEmptyArrays: true, path: "$a" });
    rejects("$unwind", "items");
    rejects("$unwind", "$");
  });
});

describe("$lookup", () => {
  const body = { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" };
  it("round-trips and summarizes", () => {
    const m = roundTrip("$lookup", body);
    expect(STAGE_CODECS["$lookup"].summarize(m)).toBe("customerId → customers._id as customer");
  });
  it("rejects pipeline/let/extra/other order/non-strings", () => {
    rejects("$lookup", { from: "c", let: {}, pipeline: [], as: "x" });
    rejects("$lookup", { ...body, pipeline: [] });
    rejects("$lookup", { as: "customer", from: "customers", localField: "a", foreignField: "b" });
    rejects("$lookup", { ...body, from: 3 });
    rejects("$lookup", { from: "c", as: "x" });
  });
});
