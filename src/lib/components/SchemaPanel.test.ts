import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { FieldSchema } from "../domain/schema";

let mockFields: FieldSchema[] = [];
vi.mock("../stores/collectionSchema.svelte", () => ({
  createCollectionSchema: () => ({
    get fields() { return mockFields; },
    get sampleSize() { return 100; },
    get actualSampled() { return mockFields.length; },
    get error() { return null; },
    get loading() { return false; },
    setSampleSize: vi.fn(),
    init: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import SchemaPanel from "./SchemaPanel.svelte";

describe("SchemaPanel", () => {
  it("renders one row per inferred field with type and presence", () => {
    mockFields = [
      { path: "_id", type: "objectId", mixed: false, presence: 1 },
      { path: "age", type: "int", mixed: true, presence: 0.5 },
    ];
    const { getByText } = render(SchemaPanel, { props: { db: "d", coll: "c" } });
    expect(getByText("_id")).toBeTruthy();
    expect(getByText("age")).toBeTruthy();
    expect(getByText("50%")).toBeTruthy();
  });
});
