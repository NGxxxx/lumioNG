import { describe, it, expect } from "vitest";
import { maskUri } from "./uri";

describe("maskUri", () => {
  it("masks the password, keeps user and host", () => {
    expect(maskUri("mongodb://alice:s3cret@db.example.com:27017/app")).toBe(
      "mongodb://alice:****@db.example.com:27017/app",
    );
  });
  it("handles mongodb+srv", () => {
    expect(maskUri("mongodb+srv://u:p@cluster0.abc.mongodb.net/")).toBe(
      "mongodb+srv://u:****@cluster0.abc.mongodb.net/",
    );
  });
  it("leaves auth-less and password-less URIs unchanged", () => {
    expect(maskUri("mongodb://localhost:27017")).toBe("mongodb://localhost:27017");
    expect(maskUri("mongodb://alice@localhost:27017")).toBe("mongodb://alice@localhost:27017");
  });
  it("returns non-URI input unchanged", () => {
    expect(maskUri("")).toBe("");
    expect(maskUri("not a uri")).toBe("not a uri");
  });
});
