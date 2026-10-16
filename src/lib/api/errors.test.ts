import { describe, it, expect } from "vitest";
import { errorMessage, rawErrorText } from "./errors";

describe("errorMessage", () => {
  it("AppError.Parse renders kind + message", () => {
    expect(errorMessage({ kind: "Parse", message: "invalid JSON" })).toBe(
      "Parse: invalid JSON",
    );
  });
});

describe("errorMessage — recognized driver errors", () => {
  it("renders the localized friendly message", () => {
    expect(errorMessage({ kind: "Query", message: "Authentication failed." })).toMatch(/^Authentication failed\./);
    expect(errorMessage({ kind: "Query", message: 'E11000 duplicate key error collection: d.u index: email_1 dup key: { email: "a" }' }))
      .toBe('A document with this value already exists (duplicate key on index "email_1").');
  });

  it("truncates long unrecognized errors", () => {
    expect(errorMessage({ kind: "Query", message: "x".repeat(400) }).endsWith("…")).toBe(true);
  });
});

describe("rawErrorText", () => {
  it("is the untranslated kind + message, stable across locales", () => {
    expect(rawErrorText({ kind: "Query", message: "E11000 duplicate key error" })).toBe("Query: E11000 duplicate key error");
    expect(rawErrorText({ kind: "NotConnected" })).toBe("NotConnected");
    expect(rawErrorText("boom")).toBe("boom");
  });
});
