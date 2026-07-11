import { describe, it, expect } from "vitest";
import { updateOneCmd, listIndexesCmd, listDatabasesCmd, findOneByIdCmd } from "./mongosh";

describe("write command-log helpers", () => {
  it("updateOneCmd", () => {
    expect(updateOneCmd("c", '{ "a": 1 }', '{ "$set": { "b": 2 } }')).toBe(
      'db.getCollection("c").updateOne({ "a": 1 }, { "$set": { "b": 2 } })',
    );
  });
});

describe("read command-log helpers", () => {
  it("listIndexesCmd", () => {
    expect(listIndexesCmd("orders")).toBe('db.getCollection("orders").getIndexes()');
  });
  it("listDatabasesCmd", () => {
    expect(listDatabasesCmd()).toBe("show dbs");
  });
  it("findOneByIdCmd", () => {
    expect(findOneByIdCmd("orders", '{"$oid":"a"}')).toBe(
      'db.getCollection("orders").findOne({ "_id": {"$oid":"a"} })',
    );
  });
});
