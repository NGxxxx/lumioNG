import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("AppError.Parse renders kind + message", () => {
    expect(errorMessage({ kind: "Parse", message: "JSON không hợp lệ" })).toBe(
      "Parse: JSON không hợp lệ",
    );
  });
});
