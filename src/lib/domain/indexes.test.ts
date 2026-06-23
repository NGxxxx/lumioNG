import { describe, it, expect } from "vitest";
import {
  parseIndexList,
  buildIndexKeys,
  validateIndexFields,
  describeKeys,
} from "./indexes";

// Index documents in Canonical ExtJSON (numbers wrapped in $numberInt).
const idIdx =
  '{"v":{"$numberInt":"2"},"key":{"_id":{"$numberInt":"1"}},"name":"_id_"}';
const emailIdx =
  '{"v":{"$numberInt":"2"},"key":{"email":{"$numberInt":"1"}},"name":"email_1","unique":true}';
const compoundIdx =
  '{"v":{"$numberInt":"2"},"key":{"age":{"$numberInt":"-1"},"name":{"$numberInt":"1"}},"name":"age_-1_name_1"}';
const ttlIdx =
  '{"v":{"$numberInt":"2"},"key":{"createdAt":{"$numberInt":"1"}},"name":"createdAt_1","expireAfterSeconds":{"$numberInt":"3600"},"sparse":true}';
const textIdx =
  '{"v":{"$numberInt":"2"},"key":{"body":"text"},"name":"body_text"}';

describe("parseIndexList", () => {
  it("marks the _id_ index", () => {
    const [r] = parseIndexList([idIdx]);
    expect(r.name).toBe("_id_");
    expect(r.isId).toBe(true);
    expect(r.entries).toEqual([{ field: "_id", value: 1 }]);
  });

  it("unique flag", () => {
    const [r] = parseIndexList([emailIdx]);
    expect(r.unique).toBe(true);
    expect(r.isId).toBe(false);
  });

  it("compound preserves field order and direction", () => {
    const [r] = parseIndexList([compoundIdx]);
    expect(r.entries).toEqual([
      { field: "age", value: -1 },
      { field: "name", value: 1 },
    ]);
  });

  it("TTL + sparse", () => {
    const [r] = parseIndexList([ttlIdx]);
    expect(r.ttl).toBe(3600);
    expect(r.sparse).toBe(true);
  });

  it("non-numeric key value is kept as a string", () => {
    const [r] = parseIndexList([textIdx]);
    expect(r.entries).toEqual([{ field: "body", value: "text" }]);
  });
});

describe("buildIndexKeys", () => {
  it("preserves field order", () => {
    expect(buildIndexKeys([{ field: "email", dir: 1 }, { field: "age", dir: -1 }])).toBe(
      '{"email":1,"age":-1}',
    );
  });
  it("trims field names", () => {
    expect(buildIndexKeys([{ field: "  x ", dir: 1 }])).toBe('{"x":1}');
  });
});

describe("validateIndexFields", () => {
  it("valid → null", () => {
    expect(validateIndexFields([{ field: "email", dir: 1 }])).toBeNull();
  });
  it("no non-empty field → err_index_no_field", () => {
    expect(validateIndexFields([{ field: "  ", dir: 1 }])).toBe("err_index_no_field");
  });
  it("duplicate field → err_index_field_duplicate", () => {
    expect(
      validateIndexFields([{ field: "a", dir: 1 }, { field: "a", dir: -1 }]),
    ).toBe("err_index_field_duplicate");
  });
});

describe("describeKeys", () => {
  it("formats for display", () => {
    expect(
      describeKeys([{ field: "email", value: 1 }, { field: "age", value: -1 }]),
    ).toBe("{ email: 1, age: -1 }");
  });
});
