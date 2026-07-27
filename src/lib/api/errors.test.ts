import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("AppError.Parse renders kind + message", () => {
    expect(errorMessage({ kind: "Parse", message: "invalid JSON" })).toBe(
      "Parse: invalid JSON",
    );
  });
});
