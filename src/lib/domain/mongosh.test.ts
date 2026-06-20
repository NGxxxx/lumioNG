import { describe, it, expect } from "vitest";
import {
  findCmd, insertCmd, replaceCmd, deleteOneCmd, updateManyCmd, deleteManyCmd,
  countCmd, createCollectionCmd, dropCollectionCmd, renameCollectionCmd,
  dropDatabaseCmd, createIndexCmd, dropIndexCmd, collStatsCmd, dbStatsCmd,
  importCmd, connectCmd,
} from "./mongosh";

describe("findCmd", () => {
  it("filter mặc định {} khi không truyền", () => {
    expect(findCmd({ coll: "users" })).toBe('db.getCollection("users").find({})');
  });
  it("đủ filter/projection/sort/skip/limit", () => {
    expect(
      findCmd({
        coll: "users",
        filter: '{"age":{"$gt":18}}',
        projection: '{"name":1}',
        sort: '{"age":1}',
        skip: 50,
        limit: 50,
      }),
    ).toBe(
      'db.getCollection("users").find({"age":{"$gt":18}}, {"name":1}).sort({"age":1}).skip(50).limit(50)',
    );
  });
  it("bỏ skip khi 0 và bỏ projection/sort khi null", () => {
    expect(findCmd({ coll: "c", filter: "{}", projection: null, sort: null, skip: 0, limit: 50 })).toBe(
      'db.getCollection("c").find({}).limit(50)',
    );
  });
});

describe("write/admin commands", () => {
  it("insertCmd", () => {
    expect(insertCmd("users", '{"a":1}')).toBe('db.getCollection("users").insertOne({"a":1})');
  });
  it("replaceCmd", () => {
    expect(replaceCmd("users", '{"$oid":"x"}', '{"a":1}')).toBe(
      'db.getCollection("users").replaceOne({ "_id": {"$oid":"x"} }, {"a":1})',
    );
  });
  it("deleteOneCmd", () => {
    expect(deleteOneCmd("users", '"a"')).toBe('db.getCollection("users").deleteOne({ "_id": "a" })');
  });
  it("updateManyCmd", () => {
    expect(updateManyCmd("users", '{"x":2}', '{"$set":{"y":1}}')).toBe(
      'db.getCollection("users").updateMany({"x":2}, {"$set":{"y":1}})',
    );
  });
  it("deleteManyCmd", () => {
    expect(deleteManyCmd("users", '{"x":2}')).toBe('db.getCollection("users").deleteMany({"x":2})');
  });
  it("countCmd", () => {
    expect(countCmd("users", "{}")).toBe('db.getCollection("users").countDocuments({})');
  });
  it("createCollectionCmd", () => {
    expect(createCollectionCmd("users")).toBe('db.createCollection("users")');
  });
  it("dropCollectionCmd", () => {
    expect(dropCollectionCmd("users")).toBe('db.getCollection("users").drop()');
  });
  it("renameCollectionCmd", () => {
    expect(renameCollectionCmd("users", "people")).toBe(
      'db.getCollection("users").renameCollection("people")',
    );
  });
  it("dropDatabaseCmd", () => {
    expect(dropDatabaseCmd()).toBe("db.dropDatabase()");
  });
  it("createIndexCmd không options", () => {
    expect(createIndexCmd("users", { age: 1 })).toBe('db.getCollection("users").createIndex({"age":1})');
  });
  it("createIndexCmd có options", () => {
    expect(createIndexCmd("users", { age: 1 }, { unique: true, name: "age_idx" })).toBe(
      'db.getCollection("users").createIndex({"age":1}, {"unique":true,"name":"age_idx"})',
    );
  });
  it("dropIndexCmd", () => {
    expect(dropIndexCmd("users", "age_idx")).toBe('db.getCollection("users").dropIndex("age_idx")');
  });
  it("collStatsCmd", () => {
    expect(collStatsCmd("users")).toBe(
      'db.getCollection("users").aggregate([{ "$collStats": { "storageStats": {} } }])',
    );
  });
  it("dbStatsCmd", () => {
    expect(dbStatsCmd()).toBe("db.stats()");
  });
  it("importCmd", () => {
    expect(importCmd("shop", "users", "/tmp/in.json")).toBe(
      'mongoimport --db shop --collection users --file "/tmp/in.json"',
    );
  });
  it("connectCmd", () => {
    expect(connectCmd("mongodb://localhost:27017")).toBe('mongosh "mongodb://localhost:27017"');
  });
});
