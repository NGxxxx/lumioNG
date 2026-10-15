import { describe, it, expect } from "vitest";
import { confirmLevel, canSuppress, describeDestructive, type DestructiveOp } from "./confirmPolicy";
import type { Environment } from "./environment";

type Level = "none" | "confirm" | "type";

// Every cell of spec §2.1 (count known). Columns: "", dev, staging, prod.
const TABLE: Record<DestructiveOp, [Level, Level, Level, Level]> = {
  deleteOne: ["confirm", "confirm", "confirm", "confirm"],
  deleteMany: ["confirm", "confirm", "confirm", "type"],
  updateMany: ["confirm", "confirm", "confirm", "type"],
  dropCollection: ["type", "type", "type", "type"],
  truncate: ["type", "type", "type", "type"],
  dropIndex: ["type", "type", "type", "type"],
  dropDatabase: ["type", "type", "type", "type"],
  script: ["confirm", "confirm", "confirm", "confirm"],
  killOp: ["confirm", "confirm", "confirm", "type"],
};
const ENVS: Environment[] = ["", "dev", "staging", "prod"];

describe("confirmLevel", () => {
  for (const [op, row] of Object.entries(TABLE) as [DestructiveOp, Level[]][]) {
    ENVS.forEach((env, i) => {
      it(`${op} in "${env}" (count 5) → ${row[i]}`, () => {
        expect(confirmLevel(env, op, 5)).toBe(row[i]);
      });
    });
  }
  it("unknown count escalates counted ops to type in every env", () => {
    for (const env of ENVS) {
      for (const op of ["deleteMany", "updateMany"] as const) {
        expect(confirmLevel(env, op, null)).toBe("type");
      }
    }
  });
  it("deleteOne and script never need typing, even without a count", () => {
    for (const env of ENVS) {
      expect(confirmLevel(env, "deleteOne", null)).not.toBe("type");
      expect(confirmLevel(env, "script", null)).not.toBe("type");
    }
  });
});

describe("canSuppress", () => {
  it("only prod scripts cannot be suppressed", () => {
    expect(canSuppress("prod", "script")).toBe(false);
    for (const env of ["", "dev", "staging"] as const) expect(canSuppress(env, "script")).toBe(true);
    expect(canSuppress("prod", "deleteMany")).toBe(true);
  });
});

describe("describeDestructive", () => {
  it("deleteMany on prod: type the collection, formatted count, keys", () => {
    const d = describeDestructive("deleteMany", { db: "shop", coll: "orders" }, 1204, "type", true);
    expect(d).toEqual({
      titleKey: "destructive_title_deleteMany",
      actionKey: "destructive_action_deleteMany",
      countText: "1,204",
      irreversible: false,
      expectedName: "orders",
      count: 1204,
    });
  });
  it("not undoable → irreversible; unknown count → null text", () => {
    const d = describeDestructive("deleteMany", { db: "shop", coll: "orders" }, null, "type", false);
    expect(d.irreversible).toBe(true);
    expect(d.countText).toBeNull();
    expect(d.count).toBeNull();
  });
  it("expectedName per op, null unless level is type", () => {
    expect(describeDestructive("dropDatabase", { db: "shop" }, null, "type", false).expectedName).toBe("shop");
    expect(describeDestructive("dropIndex", { db: "s", coll: "c", index: "a_1" }, null, "type", false).expectedName).toBe("a_1");
    expect(describeDestructive("truncate", { db: "s", coll: "c" }, 3, "type", false).expectedName).toBe("c");
    expect(describeDestructive("dropCollection", { db: "s", coll: "c" }, 3, "type", false).expectedName).toBe("c");
    expect(describeDestructive("deleteOne", { db: "s", coll: "c" }, 1, "confirm", true).expectedName).toBeNull();
    expect(describeDestructive("deleteMany", { db: "s", coll: "c" }, 3, "confirm", true).expectedName).toBeNull();
  });
});

describe("describeDestructive — several collections", () => {
  it("names the count in the title and asks for the database name", () => {
    const d = describeDestructive("dropCollection", { db: "shop", colls: ["a", "b"] }, 7, "type", false);
    expect(d.titleKey).toBe("destructive_title_dropCollections");
    expect(d.expectedName).toBe("shop");
    expect(describeDestructive("truncate", { db: "shop", colls: ["a", "b"] }, 7, "type", false).titleKey).toBe("destructive_title_truncateMany");
  });
});


describe("killOp", () => {
  it("confirms off PROD, types the opid on PROD", () => {
    expect(confirmLevel("staging", "killOp", null)).toBe("confirm");
    expect(confirmLevel("prod", "killOp", null)).toBe("type");
    expect(describeDestructive("killOp", { db: "admin", opid: "4411" }, null, "type", false).expectedName).toBe("4411");
  });
});
