import { describe, it, expect } from "vitest";
import { parseHostInfo, formatUptime } from "./host";

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
