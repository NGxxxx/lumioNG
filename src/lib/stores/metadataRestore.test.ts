import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/indexes", () => ({ createIndexesRaw: vi.fn() }));
vi.mock("../api/admin", () => ({ setCollectionValidator: vi.fn() }));

import * as indexesApi from "../api/indexes";
import * as adminApi from "../api/admin";
import { restoreCollectionMetadata } from "./metadataRestore";
import { commandLog } from "./commandLog.svelte";
import { buildMetadataBundle } from "../domain/collectionMetadata";

const createIndexesRaw = indexesApi.createIndexesRaw as ReturnType<typeof vi.fn>;
const setCollectionValidator = adminApi.setCollectionValidator as ReturnType<typeof vi.fn>;

describe("restoreCollectionMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("creates indexes and sets the validator when both are present", async () => {
    createIndexesRaw.mockResolvedValueOnce(undefined);
    setCollectionValidator.mockResolvedValueOnce(undefined);
    const bundle = buildMetadataBundle(
      ['{"key":{"a":1},"name":"a_1"}'],
      JSON.stringify({ options: { validator: { a: { $exists: true } }, validationLevel: "strict", validationAction: "error" } }),
    );
    const err = await restoreCollectionMetadata("conn:1", "d", "c", bundle);
    expect(err).toBeNull();
    expect(createIndexesRaw).toHaveBeenCalledWith("conn:1", "d", "c", JSON.stringify([{ key: { a: 1 }, name: "a_1" }]));
    expect(setCollectionValidator).toHaveBeenCalledWith("conn:1", "d", "c", JSON.stringify({ a: { $exists: true } }), "strict", "error");
  });

  it("skips setCollectionValidator when there is no validator, and skips createIndexesRaw when there are no indexes", async () => {
    const bundle = buildMetadataBundle([], JSON.stringify({ options: {} }));
    const err = await restoreCollectionMetadata("conn:1", "d", "c", bundle);
    expect(err).toBeNull();
    expect(createIndexesRaw).not.toHaveBeenCalled();
    expect(setCollectionValidator).not.toHaveBeenCalled();
  });

  it("returns null without calling any API for a malformed bundle", async () => {
    const err = await restoreCollectionMetadata("conn:1", "d", "c", "not json");
    expect(err).toBeNull();
    expect(createIndexesRaw).not.toHaveBeenCalled();
  });

  it("surfaces an API error without throwing", async () => {
    createIndexesRaw.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const bundle = buildMetadataBundle(['{"key":{"a":1},"name":"a_1"}'], JSON.stringify({ options: {} }));
    const err = await restoreCollectionMetadata("conn:1", "d", "c", bundle);
    expect(err).toContain("boom");
  });
});
