import { describe, it, expect } from "vitest";
import { toGridfsFileRow, escapeRegexLiteral } from "./gridfsFiles";

describe("toGridfsFileRow", () => {
  it("extracts filename, length, uploadDate, and metadata.contentType", () => {
    const doc = {
      _id: { $oid: "507f191e810c19729de860ea" },
      filename: "photo.png",
      length: { $numberLong: "12345" },
      uploadDate: { $date: { $numberLong: "1700000000000" } },
      metadata: { contentType: "image/png" },
    };
    const row = toGridfsFileRow(doc);
    expect(row.filename).toBe("photo.png");
    expect(row.length).toBe(12345);
    expect(row.uploadDateIso).toBe(new Date(1700000000000).toISOString());
    expect(row.contentType).toBe("image/png");
    expect(row.doc).toBe(doc);
  });

  it("handles a bare numeric length and a missing metadata document", () => {
    const doc = { filename: "a.txt", length: 10, uploadDate: { $date: { $numberLong: "0" } } };
    const row = toGridfsFileRow(doc);
    expect(row.length).toBe(10);
    expect(row.contentType).toBeUndefined();
  });

  it("returns nulls/undefined for missing or malformed fields rather than throwing", () => {
    const row = toGridfsFileRow({});
    expect(row.filename).toBeNull();
    expect(row.length).toBeNull();
    expect(row.uploadDateIso).toBeNull();
    expect(row.contentType).toBeUndefined();
  });

  it("ignores a non-string metadata.contentType", () => {
    const row = toGridfsFileRow({ metadata: { contentType: 123 } });
    expect(row.contentType).toBeUndefined();
  });
});

describe("escapeRegexLiteral", () => {
  it("escapes regex metacharacters so they match literally", () => {
    expect(escapeRegexLiteral("a(b")).toBe("a\\(b");
    expect(escapeRegexLiteral("report.v1")).toBe("report\\.v1");
    expect(escapeRegexLiteral("a.b*c?d^e$f{g}h(i)j|k[l]m\\n")).toBe(
      "a\\.b\\*c\\?d\\^e\\$f\\{g\\}h\\(i\\)j\\|k\\[l\\]m\\\\n",
    );
  });
  it("leaves a plain filename search term unchanged", () => {
    expect(escapeRegexLiteral("photo_2024")).toBe("photo_2024");
  });
});
