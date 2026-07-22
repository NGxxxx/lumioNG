import { describe, it, expect } from "vitest";
import { friendlyConnectionError } from "./connectionError";

const TOPOLOGY_ERROR =
  'Query: Server selection timeout: No available servers. Topology: { Type: ReplicaSetNoPrimary, Set Name: atlas-10ylrw-shard-0, Max Set Version: 212, Max Election ID: 7fffffff0000000000000266, Servers: [ { Address: ac-ggoq9kd-shard-00-01.cr1s8rl.mongodb.net:27017, Type: Unknown, Error: Kind: I/O error: An existing connection was forcibly closed by the remote host. (os error 10054), labels: {"SystemOverloadedError", "RetryableError"}, source: None, server response: None }, ... ] }';

describe("friendlyConnectionError", () => {
  it("maps server selection timeout / topology dumps to a short friendly message", () => {
    const result = friendlyConnectionError(TOPOLOGY_ERROR);
    expect(result.length).toBeLessThan(200);
    expect(result).not.toContain("Topology");
    expect(result.toLowerCase()).toContain("reconnecting");
  });

  it("maps authentication failures to a friendly message", () => {
    const raw = "Query: Authentication failed.";
    const result = friendlyConnectionError(raw);
    expect(result).toBe("Authentication failed. Check your credentials and try reconnecting.");
  });

  it("maps bad auth errors to the same friendly auth message", () => {
    const raw = "Connection: Kind: Authentication error: bad auth : authentication failed";
    const result = friendlyConnectionError(raw);
    expect(result).toBe("Authentication failed. Check your credentials and try reconnecting.");
  });

  it("maps DNS/host lookup failures to a friendly message", () => {
    const raw = "Connection: Kind: I/O error: failed to lookup address information: No such host is known.";
    const result = friendlyConnectionError(raw);
    expect(result).toBe("Couldn't resolve the server address. Check the connection URI and your network.");
  });

  it("maps a duplicate-key error to a friendly message naming the index", () => {
    const raw =
      'Query: E11000 duplicate key error collection: mydb.users index: email_1 dup key: { email: "a@b.com" }';
    const result = friendlyConnectionError(raw);
    expect(result).toBe('A document with this value already exists (duplicate key on index "email_1").');
  });

  it("maps a duplicate-key error without a parseable index name to a generic friendly message", () => {
    const raw = "Query: E11000 duplicate key error, something unusual";
    const result = friendlyConnectionError(raw);
    expect(result).toBe("A document with this value already exists (duplicate key).");
  });

  it("maps a document-validation failure to a friendly message", () => {
    const raw = "Query: Document failed validation";
    const result = friendlyConnectionError(raw);
    expect(result).toBe("This document doesn't satisfy the collection's validation rules.");
  });

  it("falls back to the original message when the shape is unrecognized", () => {
    const raw = "Query: Some totally new driver error we've never seen before.";
    const result = friendlyConnectionError(raw);
    expect(result).toBe(raw);
  });

  it("truncates a long, unrecognized message so it can't blow out the layout", () => {
    const raw = "Query: " + "x".repeat(400);
    const result = friendlyConnectionError(raw);
    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith("…")).toBe(true);
  });

  it("passes a short, unrecognized message through unchanged", () => {
    const raw = "Connection: refused";
    const result = friendlyConnectionError(raw);
    expect(result).toBe(raw);
  });
});
