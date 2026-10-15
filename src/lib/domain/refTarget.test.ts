import { describe, it, expect } from "vitest";
import { firstFollowable, followableValue, isSelfId, normalizeRefPath, memoryKey, nameForms, refIdText, resolveRef } from "./refTarget";

const OID = "652f0a1b2c3d4e5f60718293";
const oid = { $oid: OID };
const oidText = `{"$oid":"${OID}"}`;

describe("nameForms", () => {
  it("customerId → customer, customers", () => {
    expect(nameForms("customerId")).toEqual(expect.arrayContaining(["customer", "customers"]));
  });
  it("category_id → category, categories", () => {
    expect(nameForms("category_id")).toEqual(expect.arrayContaining(["category", "categories"]));
  });
  it("addressIds → address, addresses", () => {
    expect(nameForms("addressIds")).toEqual(expect.arrayContaining(["address", "addresses"]));
  });
  it("personId → people (irregular)", () => {
    expect(nameForms("personId")).toEqual(expect.arrayContaining(["person", "people"]));
  });
  it("other irregulars and plural suffixes", () => {
    expect(nameForms("childId")).toContain("children");
    expect(nameForms("statusId")).toContain("statuses");
    expect(nameForms("boxId")).toContain("boxes");
    expect(nameForms("branchId")).toContain("branches");
    expect(nameForms("keyId")).toContain("keys");
    expect(nameForms("keyId")).not.toContain("keies");
  });
  it("strips ID, _ids and a plural base gives singular forms", () => {
    expect(nameForms("userID")).toEqual(expect.arrayContaining(["user", "users"]));
    expect(nameForms("tag_ids")).toEqual(expect.arrayContaining(["tag", "tags"]));
    expect(nameForms("categories")).toContain("category");
    expect(nameForms("people")).toContain("person");
  });
  it("snake_case ↔ camelCase variants, lower-cased", () => {
    const camel = nameForms("orderItemId");
    expect(camel).toEqual(expect.arrayContaining(["orderitem", "orderitems", "order_item", "order_items"]));
    const snake = nameForms("order_item_id");
    expect(snake).toEqual(expect.arrayContaining(["order_item", "order_items", "orderitem", "orderitems"]));
  });
  it("is lower-cased and deduplicated", () => {
    const f = nameForms("CustomerId");
    expect(f.every((s) => s === s.toLowerCase())).toBe(true);
    expect(new Set(f).size).toBe(f.length);
  });
  it("does not strip a bare 'id' without underscore", () => {
    expect(nameForms("paid")).toContain("paid");
  });
});

describe("refIdText", () => {
  it("ObjectId → canonical text", () => {
    expect(refIdText(oid)).toBe(oidText);
  });
  it("DBRef → its $id", () => {
    expect(refIdText({ $ref: "users", $id: oid })).toBe(oidText);
    expect(refIdText({ $ref: "users", $id: "abc" })).toBe('"abc"');
    expect(refIdText({ $ref: "users", $id: { $numberInt: "7" } })).toBe('{"$numberInt":"7"}');
  });
  it("anything else → null", () => {
    expect(refIdText("abc")).toBeNull();
    expect(refIdText(null)).toBeNull();
    expect(refIdText(undefined)).toBeNull();
    expect(refIdText({ $oid: "nothex" })).toBeNull();
    expect(refIdText({ a: 1 })).toBeNull();
    expect(refIdText([oid])).toBeNull();
  });
});

describe("isSelfId", () => {
  it("only top-level _id", () => {
    expect(isSelfId("_id")).toBe(true);
    expect(isSelfId("a._id")).toBe(false);
    expect(isSelfId("id")).toBe(false);
  });
});

describe("memoryKey", () => {
  it("formats with connId or dash", () => {
    expect(memoryKey(3, "shop", "orders", "items.productId")).toBe("3|shop|orders|items.productId");
    expect(memoryKey(null, "shop", "orders", "customerId")).toBe("-|shop|orders|customerId");
  });
});

describe("resolveRef", () => {
  const base = { db: "shop", coll: "orders" };

  it("guessed single match", () => {
    expect(resolveRef({ ...base, path: "customerId", value: oid }, ["orders", "customers"], null)).toEqual({
      kind: "one",
      target: { db: "shop", coll: "customers" },
      reason: "guessed",
    });
  });
  it("items.productId uses productId", () => {
    const r = resolveRef({ ...base, path: "items.productId", value: oid }, ["products", "items"], null);
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "products" }, reason: "guessed" });
  });
  it("DBRef → one/dbref", () => {
    const r = resolveRef({ ...base, path: "owner", value: { $ref: "users", $id: oid } }, ["orders"], null);
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "users" }, reason: "dbref" });
  });
  it("dbref with $db", () => {
    const r = resolveRef(
      { ...base, path: "owner", value: { $ref: "users", $id: "u1", $db: "auth" } },
      ["users"],
      "orders",
    );
    expect(r).toEqual({ kind: "one", target: { db: "auth", coll: "users" }, reason: "dbref" });
  });
  it("remembered beats guess", () => {
    const r = resolveRef({ ...base, path: "customerId", value: oid }, ["customers", "clients"], "clients");
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "clients" }, reason: "remembered" });
  });
  it("remembered collection that no longer exists is ignored", () => {
    const r = resolveRef({ ...base, path: "customerId", value: oid }, ["customers"], "gone");
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "customers" }, reason: "guessed" });
  });
  it("two matches → many, in the collections' order", () => {
    const r = resolveRef({ ...base, path: "customerId", value: oid }, ["customers", "orders", "customer"], null);
    expect(r).toEqual({
      kind: "many",
      targets: [
        { db: "shop", coll: "customers" },
        { db: "shop", coll: "customer" },
      ],
    });
  });
  it("no match → none", () => {
    expect(resolveRef({ ...base, path: "customerId", value: oid }, ["orders", "users"], null)).toEqual({
      kind: "none",
    });
  });
  it("case-insensitive match returns the real collection name", () => {
    const r = resolveRef({ ...base, path: "customerId", value: oid }, ["Customers"], null);
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "Customers" }, reason: "guessed" });
  });
  it("camelCase field matches snake_case collection", () => {
    const r = resolveRef({ ...base, path: "orderItemId", value: oid }, ["order_items"], null);
    expect(r).toEqual({ kind: "one", target: { db: "shop", coll: "order_items" }, reason: "guessed" });
  });
  it("value without an id → none", () => {
    expect(resolveRef({ ...base, path: "customerId", value: "abc" }, ["customers"], null)).toEqual({
      kind: "none",
    });
  });
  it("self _id → none", () => {
    expect(resolveRef({ ...base, path: "_id", value: oid }, ["orders"], "orders")).toEqual({ kind: "none" });
  });
});

describe("followableValue / firstFollowable", () => {
  const oid = { $oid: "652f1a9e0000000000000c41" };
  const get = (d: Record<string, unknown>, p: string) => d[p];
  it("ObjectId, DBRef and one-element arrays are followable; _id and others are not", () => {
    expect(followableValue("customerId", oid)).toBe(oid);
    expect(followableValue("ref", { $ref: "users", $id: oid })).toEqual({ $ref: "users", $id: oid });
    expect(followableValue("tagIds", [oid])).toBe(oid);
    expect(followableValue("tagIds", [oid, oid])).toBeNull();
    expect(followableValue("_id", oid)).toBeNull();
    expect(followableValue("name", "abc")).toBeNull();
  });
  it("g prefers the clicked column, else the first followable one", () => {
    const doc = { _id: oid, name: "x", customerId: oid, productId: oid };
    expect(firstFollowable(doc, ["_id", "name", "customerId", "productId"], get)?.path).toBe("customerId");
    expect(firstFollowable(doc, ["_id", "name", "customerId", "productId"], get, "productId")?.path).toBe("productId");
    expect(firstFollowable(doc, ["_id", "name", "customerId"], get, "name")?.path).toBe("customerId");
    expect(firstFollowable({ _id: oid }, ["_id"], get)).toBeNull();
  });
});

describe("normalizeRefPath", () => {
  it("drops array indexes so every element shares a guess and a memory", () => {
    expect(normalizeRefPath("productIds.2")).toBe("productIds");
    expect(normalizeRefPath("items.0.productId")).toBe("items.productId");
    expect(normalizeRefPath("customerId")).toBe("customerId");
    expect(resolveRef({ path: normalizeRefPath("productIds.2"), value: { $oid: "652f1a9e0000000000000c41" }, db: "d", coll: "c" }, ["products"], null))
      .toEqual({ kind: "one", target: { db: "d", coll: "products" }, reason: "guessed" });
  });
});
