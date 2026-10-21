import { describe, it, expect } from "vitest";
import {
  isAtlasHost, isAtlasUri, isSearchUnsupported, parseSearchIndexList, validateSearchDefinition,
  SEARCH_TEMPLATES, clusterUri, clusterStatus, type AtlasCluster,
} from "./atlas";

describe("is_atlas_host", () => {
  it("matches *.mongodb.net hosts only", () => {
    expect(isAtlasHost("cluster0.ab1cd.mongodb.net")).toBe(true);
    expect(isAtlasHost("Cluster0-shard-00-01.AB1CD.MONGODB.NET:27017")).toBe(true);
    expect(isAtlasHost("cluster0-pri.ab1cd.mongodb.net.")).toBe(true);
    expect(isAtlasHost("mongodb.net")).toBe(false);
    expect(isAtlasHost("evilmongodb.net")).toBe(false);
    expect(isAtlasHost("cluster0.mongodb.net.evil.com")).toBe(false);
    expect(isAtlasHost("localhost")).toBe(false);
    expect(isAtlasHost("")).toBe(false);
  });
  it("looks at every host of a connection string, ignoring credentials", () => {
    expect(isAtlasUri("mongodb+srv://u:p%40ss@cluster0.ab1cd.mongodb.net/db?retryWrites=true")).toBe(true);
    expect(isAtlasUri("mongodb://a.mongodb.net:27017,b.mongodb.net:27017/?ssl=true")).toBe(true);
    expect(isAtlasUri("mongodb://localhost:27017/?directConnection=true")).toBe(false);
    expect(isAtlasUri("mongodb://u:x@host.mongodb.net.example.com/db")).toBe(false);
    expect(isAtlasUri("not a uri")).toBe(false);
    expect(isAtlasUri(undefined)).toBe(false);
  });
});

describe("isSearchUnsupported", () => {
  it("recognizes the errors a plain mongod gives", () => {
    expect(isSearchUnsupported("Query: Using Atlas Search Database Commands and the $listSearchIndexes aggregation stage requires additional configuration.")).toBe(true);
    expect(isSearchUnsupported("Query error: Unrecognized pipeline stage name: '$listSearchIndexes'")).toBe(true);
    expect(isSearchUnsupported("no such command: 'createSearchIndexes'")).toBe(true);
    expect(isSearchUnsupported("Query error: Command not supported (CommandNotSupported)")).toBe(true);
    expect(isSearchUnsupported("Query: not authorized on db")).toBe(false);
  });
});

describe("validateSearchDefinition", () => {
  it("accepts a JSON object and rejects the rest", () => {
    expect(validateSearchDefinition('{"mappings":{"dynamic":true}}', "search")).toBeNull();
    expect(validateSearchDefinition("", "search")).toBe("empty");
    expect(validateSearchDefinition("{", "search")).toBe("json");
    expect(validateSearchDefinition("[1]", "search")).toBe("object");
    expect(validateSearchDefinition("{}", "search")).toBe("empty");
  });
  it("needs a fields array for vector search and mappings for search", () => {
    expect(validateSearchDefinition('{"fields":[{"type":"vector","path":"e","numDimensions":3,"similarity":"cosine"}]}', "vectorSearch")).toBeNull();
    expect(validateSearchDefinition('{"mappings":{"dynamic":true}}', "vectorSearch")).toBe("vectorFields");
    expect(validateSearchDefinition('{"fields":[]}', "vectorSearch")).toBe("vectorFields");
    expect(validateSearchDefinition('{"analyzer":"lucene.standard"}', "search")).toBe("searchMappings");
  });
  it("every template is valid for its own type", () => {
    for (const t of SEARCH_TEMPLATES) expect(validateSearchDefinition(t.definition, t.type), t.id).toBeNull();
    expect(SEARCH_TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(["dynamic", "vector"]));
  });
});

describe("parseSearchIndexList", () => {
  it("reads name, type, status and the definition from $listSearchIndexes documents", () => {
    const rows = parseSearchIndexList([
      JSON.stringify({ id: "1", name: "default", type: "search", status: "READY", queryable: true, latestDefinition: { mappings: { dynamic: true } } }),
      JSON.stringify({ name: "vec", type: "vectorSearch", status: "BUILDING", queryable: false, latestDefinition: { fields: [] } }),
      JSON.stringify({ name: "old", definition: { mappings: { dynamic: false } } }),
    ]);
    expect(rows.map((r) => [r.name, r.type, r.status, r.queryable])).toEqual([
      ["default", "search", "READY", true], ["vec", "vectorSearch", "BUILDING", false], ["old", "search", "", false],
    ]);
    expect(JSON.parse(rows[0].definition)).toEqual({ mappings: { dynamic: true } });
    expect(JSON.parse(rows[2].definition)).toEqual({ mappings: { dynamic: false } });
  });
  it("skips documents without a name", () => {
    expect(parseSearchIndexList([JSON.stringify({ status: "READY" })])).toEqual([]);
  });
});

describe("cluster helpers", () => {
  const base: AtlasCluster = { name: "C0", state: "IDLE", clusterType: "REPLICASET", mongoVersion: "7.0", srv: "mongodb+srv://c0.ab.mongodb.net", standard: "mongodb://h1:27017,h2:27017/?ssl=true", privateSrv: null };
  it("prefers the SRV string and falls back to the standard one", () => {
    expect(clusterUri(base)).toBe("mongodb+srv://c0.ab.mongodb.net");
    expect(clusterUri({ ...base, srv: null })).toBe("mongodb://h1:27017,h2:27017/?ssl=true");
    expect(clusterUri({ ...base, srv: null, standard: null })).toBeNull();
  });
  it("flags clusters that cannot be connected to", () => {
    expect(clusterStatus(base)).toBe("ready");
    expect(clusterStatus({ ...base, srv: null, standard: null })).toBe("noConnection");
  });
});
