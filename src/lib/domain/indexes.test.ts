import { describe, it, expect } from "vitest";
import {
  parseIndexList,
  buildIndexKeys,
  validateIndexFields,
  describeKeys,
} from "./indexes";

// Index doc theo Canonical ExtJSON (số bọc trong $numberInt).
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
  it("đánh dấu _id_", () => {
    const [r] = parseIndexList([idIdx]);
    expect(r.name).toBe("_id_");
    expect(r.isId).toBe(true);
    expect(r.entries).toEqual([{ field: "_id", value: 1 }]);
  });

  it("cờ unique", () => {
    const [r] = parseIndexList([emailIdx]);
    expect(r.unique).toBe(true);
    expect(r.isId).toBe(false);
  });

  it("compound giữ thứ tự field + dấu", () => {
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

  it("key phi-số giữ nguyên chuỗi", () => {
    const [r] = parseIndexList([textIdx]);
    expect(r.entries).toEqual([{ field: "body", value: "text" }]);
  });
});

describe("buildIndexKeys", () => {
  it("giữ thứ tự field", () => {
    expect(buildIndexKeys([{ field: "email", dir: 1 }, { field: "age", dir: -1 }])).toBe(
      '{"email":1,"age":-1}',
    );
  });
  it("trim tên field", () => {
    expect(buildIndexKeys([{ field: "  x ", dir: 1 }])).toBe('{"x":1}');
  });
});

describe("validateIndexFields", () => {
  it("hợp lệ → null", () => {
    expect(validateIndexFields([{ field: "email", dir: 1 }])).toBeNull();
  });
  it("không field → lỗi", () => {
    expect(validateIndexFields([{ field: "  ", dir: 1 }])).not.toBeNull();
  });
  it("field trùng → lỗi", () => {
    expect(
      validateIndexFields([{ field: "a", dir: 1 }, { field: "a", dir: -1 }]),
    ).not.toBeNull();
  });
});

describe("describeKeys", () => {
  it("format hiển thị", () => {
    expect(
      describeKeys([{ field: "email", value: 1 }, { field: "age", value: -1 }]),
    ).toBe("{ email: 1, age: -1 }");
  });
});
