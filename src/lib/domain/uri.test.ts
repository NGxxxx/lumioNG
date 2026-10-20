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

describe("maskUri — option secrets", () => {
  it("masks the proxy password, the cert key password and the AWS session token", () => {
    expect(maskUri("mongodb://h/?proxyHost=p&proxyPassword=a%40b&tlsCertificateKeyFilePassword=x&tls=true")).toBe(
      "mongodb://h/?proxyHost=p&proxyPassword=****&tlsCertificateKeyFilePassword=****&tls=true",
    );
    expect(maskUri("mongodb://k:s@h/?authMechanismProperties=AWS_SESSION_TOKEN:tok%2Fen&tls=true")).toBe(
      "mongodb://k:****@h/?authMechanismProperties=AWS_SESSION_TOKEN:****&tls=true",
    );
  });
});
