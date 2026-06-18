import { describe, it, expect } from "vitest";
import { getByPath, flattenPaths, inferSchema, mergeColumns } from "./schema";

describe("getByPath", () => {
  it("đọc field cấp 1", () => {
    expect(getByPath({ name: "a" }, "name")).toBe("a");
  });
  it("đọc dot-path lồng nhau", () => {
    expect(getByPath({ address: { city: "HCM" } }, "address.city")).toBe("HCM");
  });
  it("path thiếu → undefined", () => {
    expect(getByPath({ address: { city: "HCM" } }, "address.zip")).toBeUndefined();
    expect(getByPath({ x: 1 }, "y")).toBeUndefined();
  });
  it("đi vào scalar/array giữa chừng → undefined", () => {
    expect(getByPath({ a: 5 }, "a.b")).toBeUndefined();
    expect(getByPath({ a: [1, 2] }, "a.b")).toBeUndefined();
  });
});

describe("flattenPaths", () => {
  it("scalar cấp 1, _id đứng đầu", () => {
    expect(flattenPaths([{ name: "a", _id: { $oid: "1" } }])).toEqual(["_id", "name"]);
  });
  it("flatten object lồng nhau thành dot-path", () => {
    const docs = [{ _id: { $oid: "1" }, address: { city: "HCM", zip: "70000" } }];
    expect(flattenPaths(docs)).toEqual(["_id", "address.city", "address.zip"]);
  });
  it("array là leaf, không đi sâu", () => {
    const docs = [{ _id: { $oid: "1" }, tags: ["x", "y"], items: [{ a: 1 }] }];
    expect(flattenPaths(docs)).toEqual(["_id", "tags", "items"]);
  });
  it("object rỗng là leaf", () => {
    expect(flattenPaths([{ meta: {} }])).toEqual(["meta"]);
  });
  it("gộp path qua nhiều doc, giữ thứ tự phát hiện", () => {
    const docs = [{ _id: { $oid: "1" }, a: 1 }, { _id: { $oid: "2" }, b: 2 }];
    expect(flattenPaths(docs)).toEqual(["_id", "a", "b"]);
  });
});

describe("inferSchema", () => {
  it("suy kiểu trội + presence cho field cấp 1", () => {
    const docs = [
      { _id: { $oid: "1" }, name: "a", age: { $numberInt: "1" } },
      { _id: { $oid: "2" }, name: "b" },
    ];
    const s = inferSchema(docs);
    expect(s.sampleSize).toBe(2);
    const name = s.fields.find((f) => f.path === "name")!;
    expect(name.type).toBe("string");
    expect(name.mixed).toBe(false);
    expect(name.presence).toBe(1);
    const age = s.fields.find((f) => f.path === "age")!;
    expect(age.type).toBe("int");
    expect(age.presence).toBe(0.5);
  });
  it("_id luôn đứng đầu", () => {
    const s = inferSchema([{ a: 1, _id: { $oid: "1" } }]);
    expect(s.fields[0].path).toBe("_id");
  });
  it("nhiều kiểu qua các doc → dominant + mixed", () => {
    const docs = [{ x: "s" }, { x: { $numberInt: "1" } }, { x: "t" }];
    const x = inferSchema(docs).fields.find((f) => f.path === "x")!;
    expect(x.type).toBe("string");
    expect(x.mixed).toBe(true);
  });
  it("wrapper ExtJSON là leaf đúng kiểu, không recurse", () => {
    const docs = [
      {
        oid: { $oid: "1" },
        when: { $date: "2020-01-01T00:00:00Z" },
        big: { $numberLong: "9" },
        bin: { $binary: { base64: "AAAA", subType: "00" } },
      },
    ];
    const s = inferSchema(docs);
    const paths = s.fields.map((f) => f.path);
    expect(paths).toEqual(["oid", "when", "big", "bin"]);
    expect(s.fields.find((f) => f.path === "oid")!.type).toBe("objectId");
    expect(s.fields.find((f) => f.path === "when")!.type).toBe("date");
    expect(s.fields.find((f) => f.path === "big")!.type).toBe("long");
    expect(s.fields.find((f) => f.path === "bin")!.type).toBe("binary");
  });
  it("field lúc object lúc scalar → có cả cột cha lẫn con", () => {
    const docs = [{ a: 5 }, { a: { b: 1 } }];
    const paths = inferSchema(docs).fields.map((f) => f.path);
    expect(paths).toContain("a");
    expect(paths).toContain("a.b");
  });
  it("docs rỗng → sampleSize 0, fields rỗng (không chia cho 0)", () => {
    expect(inferSchema([])).toEqual({ sampleSize: 0, fields: [] });
  });
});

describe("mergeColumns", () => {
  it("schema null → row-derived (path thừa không metadata)", () => {
    const cols = mergeColumns(null, [{ _id: { $oid: "1" }, x: 1 }]);
    expect(cols.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(cols[1].type).toBeUndefined();
  });
  it("field thừa ngoài schema được append cuối, không metadata", () => {
    const schema = inferSchema([{ _id: { $oid: "1" }, x: 1 }]);
    const cols = mergeColumns(schema, [{ _id: { $oid: "1" }, x: 1, extra: 9 }]);
    const extra = cols.find((c) => c.path === "extra")!;
    expect(cols[cols.length - 1].path).toBe("extra");
    expect(extra.type).toBeUndefined();
    expect(cols.find((c) => c.path === "x")!.type).toBeDefined();
  });
});
