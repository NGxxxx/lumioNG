import { describe, it, expect } from "vitest";
import { classifyError, truncateError } from "./connectionError";

const TOPOLOGY_ERROR =
  'Query: Server selection timeout: No available servers. Topology: { Type: ReplicaSetNoPrimary, Set Name: atlas-10ylrw-shard-0, Max Set Version: 212, Max Election ID: 7fffffff0000000000000266, Servers: [ { Address: ac-ggoq9kd-shard-00-01.cr1s8rl.mongodb.net:27017, Type: Unknown, Error: Kind: I/O error: An existing connection was forcibly closed by the remote host. (os error 10054), labels: {"SystemOverloadedError", "RetryableError"}, source: None, server response: None }, ... ] }';

describe("classifyError", () => {
  it("an unreachable Atlas cluster points at the IP access list", () => {
    expect(classifyError(TOPOLOGY_ERROR)).toEqual({ key: "err_conn_atlas_unreachable" });
  });

  it("other server selection timeouts are 'can't reach the server'", () => {
    expect(classifyError("Query: Server selection timeout: No available servers. Topology: { Type: Unknown, Servers: [ { Address: db.local:27017 } ] }"))
      .toEqual({ key: "err_conn_unreachable" });
  });

  it("a refused connection says nothing is listening", () => {
    expect(classifyError("Connection: Kind: I/O error: Connection refused (os error 111)")).toEqual({ key: "err_conn_refused" });
    expect(classifyError("Query: Server selection timeout: ... Error: Kind: I/O error: No connection could be made because the target machine actively refused it. (os error 10061)"))
      .toEqual({ key: "err_conn_refused" });
  });

  it("TLS / certificate failures", () => {
    expect(classifyError("Connection: Kind: I/O error: invalid peer certificate: UnknownIssuer")).toEqual({ key: "err_conn_tls" });
    expect(classifyError("Connection: Kind: I/O error: received corrupt message of type InvalidContentType")).toEqual({ key: "err_conn_tls" });
  });

  it("authentication failures (both driver phrasings)", () => {
    expect(classifyError("Query: Authentication failed.")).toEqual({ key: "err_auth_failed" });
    expect(classifyError("Connection: Kind: Authentication error: bad auth : authentication failed")).toEqual({ key: "err_auth_failed" });
  });

  it("DNS / host lookup failures", () => {
    expect(classifyError("Connection: Kind: I/O error: failed to lookup address information: No such host is known."))
      .toEqual({ key: "err_conn_dns" });
  });

  it("missing privileges name the database", () => {
    expect(classifyError("Query: Command failed: not authorized on admin to execute command { serverStatus: 1 }"))
      .toEqual({ key: "err_not_authorized", params: { db: "admin" } });
  });

  it("duplicate keys, with and without a parseable index name", () => {
    expect(classifyError('Query: E11000 duplicate key error collection: mydb.users index: email_1 dup key: { email: "a@b.com" }'))
      .toEqual({ key: "err_dup_key_index", params: { index: "email_1" } });
    expect(classifyError("Query: E11000 duplicate key error, something unusual")).toEqual({ key: "err_dup_key" });
  });

  it("a duplicate key in a collection whose name looks like a TLS term is still a duplicate key", () => {
    expect(classifyError("Query: E11000 duplicate key error collection: app.certificates index: serial_1 dup key: { serial: 1 }"))
      .toEqual({ key: "err_dup_key_index", params: { index: "serial_1" } });
  });

  it("document validation failures", () => {
    expect(classifyError("Query: Document failed validation")).toEqual({ key: "err_validation_failed" });
  });

  it("anything else is unrecognized", () => {
    expect(classifyError("Query: Some totally new driver error we've never seen before.")).toBeNull();
    expect(classifyError("Connection: refused")).toBeNull();
  });
});

describe("truncateError", () => {
  it("cuts a long message so it can't blow out the layout", () => {
    const out = truncateError("Query: " + "x".repeat(400));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("…")).toBe(true);
  });

  it("passes a short message through", () => {
    expect(truncateError("Connection: refused")).toBe("Connection: refused");
  });
});
