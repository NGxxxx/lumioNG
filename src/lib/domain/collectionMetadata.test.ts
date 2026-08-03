import { describe, it, expect } from "vitest";
import { metadataPathFor, buildMetadataBundle, parseMetadataBundle } from "./collectionMetadata";

describe("metadataPathFor", () => {
  it("swaps the extension for .metadata.json", () => {
    expect(metadataPathFor("/tmp/orders.json")).toBe("/tmp/orders.metadata.json");
  });
  it("handles Windows-style paths", () => {
    expect(metadataPathFor("C:\\out\\db.orders.csv")).toBe("C:\\out\\db.orders.metadata.json");
  });
  it("treats a dot before the last path separator as not an extension", () => {
    expect(metadataPathFor("/tmp/a.b/orders")).toBe("/tmp/a.b/orders.metadata.json");
  });
});

describe("buildMetadataBundle / parseMetadataBundle", () => {
  it("round-trips indexes and a validator", () => {
    const indexes = ['{"v":2,"key":{"_id":1},"name":"_id_"}', '{"v":2,"key":{"status":1},"name":"status_1"}'];
    const optionsJson = JSON.stringify({
      name: "orders",
      type: "collection",
      options: { validator: { status: { $exists: true } }, validationLevel: "strict", validationAction: "error" },
    });
    const bundle = buildMetadataBundle(indexes, optionsJson);
    const parsed = parseMetadataBundle(bundle);
    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.indexesJson)).toEqual([
      { v: 2, key: { _id: 1 }, name: "_id_" },
      { v: 2, key: { status: 1 }, name: "status_1" },
    ]);
    expect(JSON.parse(parsed!.validatorJson!)).toEqual({ status: { $exists: true } });
    expect(parsed!.validationLevel).toBe("strict");
    expect(parsed!.validationAction).toBe("error");
  });

  it("reports no validator when the collection had none", () => {
    const bundle = buildMetadataBundle([], JSON.stringify({ name: "orders", options: {} }));
    const parsed = parseMetadataBundle(bundle);
    expect(parsed!.validatorJson).toBeNull();
    expect(parsed!.validationLevel).toBe("strict");
    expect(parsed!.validationAction).toBe("error");
  });

  it("returns null for malformed JSON", () => {
    expect(parseMetadataBundle("not json")).toBeNull();
  });

  it("returns null when indexes is missing", () => {
    expect(parseMetadataBundle(JSON.stringify({ options: {} }))).toBeNull();
  });
});
