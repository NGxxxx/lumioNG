import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/csv", () => ({
  csvImportPreview: vi.fn(),
  csvImportCommit: vi.fn(),
}));

import * as api from "../api/csv";
import { createCsvImport } from "./csvImport.svelte";
import { commandLog } from "./commandLog.svelte";

const csvImportPreview = api.csvImportPreview as ReturnType<typeof vi.fn>;
const csvImportCommit = api.csvImportCommit as ReturnType<typeof vi.fn>;

const preview = [
  { path: "id", inferredType: "int", samples: ["1", "2"] },
  { path: "name", inferredType: "string", samples: ["Ada", "Grace"] },
];

describe("createCsvImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("loadPreview fetches columns with comma delimiter and both infer flags on by default", async () => {
    csvImportPreview.mockResolvedValueOnce(preview);
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    expect(csvImportPreview).toHaveBeenCalledWith(
      "/tmp/data.csv", "comma", { parseJsonLike: true, inferScalars: true },
    );
    expect(v.phase).toBe("config");
    expect(v.columns).toEqual(preview);
    expect(v.error).toBeNull();
  });

  it("loadPreview surfaces an error without throwing, and still reaches config", async () => {
    csvImportPreview.mockRejectedValueOnce({ kind: "Parse", message: "bad header" });
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    expect(v.error).toContain("bad header");
    expect(v.phase).toBe("config");
  });

  it("setDelimiter updates state and reloads the preview with the new delimiter", async () => {
    csvImportPreview.mockResolvedValue(preview);
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.setDelimiter("semicolon");
    expect(v.delimiter).toBe("semicolon");
    expect(csvImportPreview).toHaveBeenLastCalledWith(
      "/tmp/data.csv", "semicolon", { parseJsonLike: true, inferScalars: true },
    );
  });

  it("toggleParseJsonLike flips the flag and reloads the preview", async () => {
    csvImportPreview.mockResolvedValue(preview);
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.toggleParseJsonLike();
    expect(v.parseJsonLike).toBe(false);
    expect(csvImportPreview).toHaveBeenLastCalledWith(
      "/tmp/data.csv", "comma", { parseJsonLike: false, inferScalars: true },
    );
  });

  it("toggleInferScalars flips the flag and reloads the preview", async () => {
    csvImportPreview.mockResolvedValue(preview);
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.toggleInferScalars();
    expect(v.inferScalars).toBe(false);
    expect(csvImportPreview).toHaveBeenLastCalledWith(
      "/tmp/data.csv", "comma", { parseJsonLike: true, inferScalars: false },
    );
  });

  it("run commits with the current delimiter/options and reports the result", async () => {
    csvImportPreview.mockResolvedValueOnce(preview);
    csvImportCommit.mockResolvedValueOnce({ inserted: 2, failed: 0, errors: [] });
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.run();
    expect(csvImportCommit).toHaveBeenCalledWith(
      "conn:1", "d", "users", "/tmp/data.csv", "comma",
      { parseJsonLike: true, inferScalars: true }, "skipDuplicates", expect.any(Function),
    );
    expect(v.phase).toBe("done");
    expect(v.result).toEqual({ inserted: 2, failed: 0, errors: [] });
  });

  it("run surfaces a commit error and returns to config", async () => {
    csvImportPreview.mockResolvedValueOnce(preview);
    csvImportCommit.mockRejectedValueOnce({ kind: "Query", message: "not writable" });
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.run();
    expect(v.error).toContain("not writable");
    expect(v.phase).toBe("config");
  });

  it("run pushes a command-log entry with a measured duration", async () => {
    csvImportPreview.mockResolvedValueOnce(preview);
    csvImportCommit.mockResolvedValueOnce({ inserted: 0, failed: 0, errors: [] });
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    await v.run();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
    expect(entry.text).toContain("users");
  });

  it("setInsertMode overrides the mode captured at construction, and it flows through to commit", async () => {
    csvImportPreview.mockResolvedValueOnce(preview);
    csvImportCommit.mockResolvedValueOnce({ inserted: 2, failed: 0, errors: [] });
    const v = createCsvImport("conn:1", "d", "users", "/tmp/data.csv", "skipDuplicates");
    await v.loadPreview();
    v.setInsertMode("upsertById");
    await v.run();
    expect(csvImportCommit).toHaveBeenCalledWith(
      "conn:1", "d", "users", "/tmp/data.csv", "comma",
      { parseJsonLike: true, inferScalars: true }, "upsertById", expect.any(Function),
    );
  });
});
