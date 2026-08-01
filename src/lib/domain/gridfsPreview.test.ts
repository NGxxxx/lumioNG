import { describe, it, expect } from "vitest";
import { classifyPreviewKind, base64ToUtf8Text, imageMimeType } from "./gridfsPreview";

describe("classifyPreviewKind", () => {
  it("classifies by MIME-shaped contentType first", () => {
    expect(classifyPreviewKind("x", "image/png")).toBe("image");
    expect(classifyPreviewKind("x", "application/pdf")).toBe("pdf");
    expect(classifyPreviewKind("x", "text/plain")).toBe("text");
    expect(classifyPreviewKind("x", "application/json")).toBe("text");
  });
  it("falls back to the filename extension when contentType is absent", () => {
    expect(classifyPreviewKind("photo.JPG", undefined)).toBe("image");
    expect(classifyPreviewKind("doc.pdf", undefined)).toBe("pdf");
    expect(classifyPreviewKind("notes.md", undefined)).toBe("text");
  });
  it("falls back to the extension when contentType isn't MIME-shaped", () => {
    expect(classifyPreviewKind("photo.png", "unknown")).toBe("image");
  });
  it("returns unknown when neither resolves", () => {
    expect(classifyPreviewKind("archive.zip", undefined)).toBe("unknown");
    expect(classifyPreviewKind(null, undefined)).toBe("unknown");
  });
});

describe("base64ToUtf8Text", () => {
  it("decodes plain ASCII text", () => {
    expect(base64ToUtf8Text(btoa("hello world"))).toBe("hello world");
  });

  it("decodes non-ASCII UTF-8 text (Vietnamese diacritics), unlike a bare atob()", () => {
    const text = "Xin chào, đây là tiếng Việt.";
    const bytes = new TextEncoder().encode(text);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(base64ToUtf8Text(base64)).toBe(text);
    // Sanity check this test would actually catch the Latin-1 bug: a bare atob() must NOT equal
    // the original text for this input.
    expect(atob(base64)).not.toBe(text);
  });
});

describe("imageMimeType", () => {
  it("prefers a MIME-shaped contentType", () => {
    expect(imageMimeType("x", "image/png")).toBe("image/png");
  });
  it("maps known extensions to concrete MIME types", () => {
    expect(imageMimeType("photo.jpg", undefined)).toBe("image/jpeg");
    expect(imageMimeType("photo.jpeg", undefined)).toBe("image/jpeg");
    expect(imageMimeType("photo.png", undefined)).toBe("image/png");
    expect(imageMimeType("photo.gif", undefined)).toBe("image/gif");
    expect(imageMimeType("photo.webp", undefined)).toBe("image/webp");
    expect(imageMimeType("photo.bmp", undefined)).toBe("image/bmp");
    expect(imageMimeType("icon.svg", undefined)).toBe("image/svg+xml");
  });
  it("falls back to application/octet-stream when nothing resolves", () => {
    expect(imageMimeType("mystery", undefined)).toBe("application/octet-stream");
  });
});
