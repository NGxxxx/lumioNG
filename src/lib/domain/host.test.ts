import { describe, it, expect } from "vitest";
import { parseHostInfo, formatUptime, parseCurrentOps, parseStartupLog } from "./host";

const ss = JSON.stringify({
  version: "7.0.5",
  uptime: { $numberDouble: "3725.0" },
  localTime: { $date: { $numberLong: "1700000000000" } },
  connections: { current: { $numberInt: "4" }, available: { $numberInt: "1000" } },
  mem: { resident: { $numberInt: "120" }, virtual: { $numberInt: "1500" } },
  opcounters: { insert: { $numberInt: "10" }, query: { $numberInt: "20" } },
  network: { bytesIn: { $numberLong: "999" }, bytesOut: { $numberLong: "888" }, numRequests: { $numberLong: "7" } },
  storageEngine: { name: "wiredTiger" },
});
const bi = JSON.stringify({ version: "7.0.5", gitVersion: "abc" });
const hi = JSON.stringify({ system: { hostname: "db-1" }, os: { name: "Ubuntu", version: "22.04" } });

describe("parseHostInfo", () => {
  it("extracts curated metrics", () => {
    const h = parseHostInfo(ss, bi, hi);
    expect(h.version).toBe("7.0.5");
    expect(h.storageEngine).toBe("wiredTiger");
    expect(h.uptimeSeconds).toBe(3725);
    expect(h.localTimeIso).toBe("2023-11-14T22:13:20.000Z");
    expect(h.connectionsCurrent).toBe(4);
    expect(h.memResidentMb).toBe(120);
    expect(h.opcounters.query).toBe(20);
    expect(h.network.bytesIn).toBe(999);
    expect(h.hostname).toBe("db-1");
    expect(h.os).toBe("Ubuntu 22.04");
  });

  it("soft-fails when hostInfo is absent", () => {
    const h = parseHostInfo(ss, bi, null);
    expect(h.hostname).toBeNull();
    expect(h.os).toBeNull();
    expect(h.version).toBe("7.0.5");
  });

  it("falls back to buildInfo version when serverStatus omits it", () => {
    const ssNoVer = JSON.stringify({ connections: {}, mem: {}, network: {} });
    const h = parseHostInfo(ssNoVer, JSON.stringify({ version: "6.0.1" }), null);
    expect(h.version).toBe("6.0.1");
  });

  it("soft-fails when serverStatus is absent (e.g. lacking clusterMonitor privilege)", () => {
    const h = parseHostInfo(null, bi, null);
    expect(h.version).toBe("7.0.5"); // still falls back to buildInfo
    expect(h.uptimeSeconds).toBeNull();
    expect(h.connectionsCurrent).toBeNull();
  });

  it("builds os from name alone when version is missing", () => {
    const h = parseHostInfo(ss, bi, JSON.stringify({ os: { name: "Ubuntu" } }));
    expect(h.os).toBe("Ubuntu");
  });
});

describe("formatUptime", () => {
  it("formats seconds as d/h/m", () => {
    expect(formatUptime(3725)).toBe("1h 2m");
    expect(formatUptime(90061)).toBe("1d 1h 1m");
    expect(formatUptime(null)).toBe("—");
  });

  it("returns — for negative seconds", () => {
    expect(formatUptime(-5)).toBe("—");
  });
});

describe("parseCurrentOps", () => {
  it("curates inprog entries sorted by longest-running first", () => {
    const json = JSON.stringify({
      inprog: [
        { opid: { $numberInt: "1" }, secs_running: { $numberInt: "2" }, op: "query", ns: "d.c", client: "1.2.3.4:5", appName: "mongosh 2.1.1" },
        { opid: { $numberInt: "2" }, secs_running: { $numberInt: "40" }, op: "update", ns: "d.c2", client: "1.2.3.4:6", desc: "conn7", appName: "LumioNG" },
      ],
    });
    const ops = parseCurrentOps(json);
    expect(ops).toHaveLength(2);
    expect(ops[0].opid).toBe(2);
    expect(ops[0].secsRunning).toBe(40);
    expect(ops[0].desc).toBe("conn7");
    expect(ops[0].appName).toBe("LumioNG");
    expect(ops[1].opid).toBe(1);
    expect(ops[1].op).toBe("query");
    expect(ops[1].appName).toBe("mongosh 2.1.1");
  });

  it("skips entries with a non-numeric (sharded-cluster) opid", () => {
    const json = JSON.stringify({ inprog: [{ opid: "shard01:5", op: "query" }] });
    expect(parseCurrentOps(json)).toEqual([]);
  });

  it("returns an empty list when inprog is absent", () => {
    expect(parseCurrentOps(JSON.stringify({}))).toEqual([]);
  });
});

describe("parseStartupLog", () => {
  it("curates hostname/startTime/pid/version/cmdLine from a startup_log doc", () => {
    const raw = JSON.stringify({
      hostname: "box1",
      startTime: { $date: "2026-01-02T03:04:05Z" },
      pid: { $numberInt: "4242" },
      buildinfo: { version: "7.0.5", gitVersion: "abc123" },
      cmdLine: { net: { port: { $numberInt: "27017" } } },
    });
    const [entry] = parseStartupLog([raw]);
    expect(entry.hostname).toBe("box1");
    expect(entry.startTimeIso).toContain("2026-01-02");
    expect(entry.pid).toBe(4242);
    expect(entry.version).toBe("7.0.5");
    expect(entry.cmdLineText).toContain("27017");
  });

  it("tolerates missing fields", () => {
    const [entry] = parseStartupLog(["{}"]);
    expect(entry.hostname).toBeNull();
    expect(entry.startTimeIso).toBeNull();
    expect(entry.pid).toBeNull();
    expect(entry.version).toBeNull();
    expect(entry.cmdLineText).toBeNull();
  });

  it("preserves input order (already newest-first from the backend query)", () => {
    const docs = ['{"hostname":"a"}', '{"hostname":"b"}'];
    expect(parseStartupLog(docs).map((e) => e.hostname)).toEqual(["a", "b"]);
  });
});
