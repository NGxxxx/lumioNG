import { numFromExt } from "./extjson";

/** Format bytes: null→"—", <1KB→"N B", còn lại KB/MB/GB/TB (1 chữ số thập phân). */
export function formatBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

/** Format số đếm: null→"—", nhóm hàng nghìn (vd 1234567→"1,234,567"). */
export function formatCount(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}

export interface CollStatsInfo {
  ns: string;
  count: number | null;
  size: number | null;
  avgObjSize: number | null;
  storageSize: number | null;
  totalIndexSize: number | null;
  nindexes: number | null;
  indexSizes: { name: string; bytes: number | null }[];
  capped: boolean;
}

export function parseCollStats(json: string): CollStatsInfo {
  const d = JSON.parse(json) as Record<string, unknown>;
  const idxSizes = (d.indexSizes ?? {}) as Record<string, unknown>;
  return {
    ns: String(d.ns ?? ""),
    count: numFromExt(d.count),
    size: numFromExt(d.size),
    avgObjSize: numFromExt(d.avgObjSize),
    storageSize: numFromExt(d.storageSize),
    totalIndexSize: numFromExt(d.totalIndexSize),
    nindexes: numFromExt(d.nindexes),
    indexSizes: Object.entries(idxSizes).map(([name, bytes]) => ({ name, bytes: numFromExt(bytes) })),
    capped: d.capped === true,
  };
}

export interface DbStatsInfo {
  db: string;
  collections: number | null;
  objects: number | null;
  dataSize: number | null;
  storageSize: number | null;
  indexes: number | null;
  indexSize: number | null;
}

export function parseDbStats(json: string): DbStatsInfo {
  const d = JSON.parse(json) as Record<string, unknown>;
  return {
    db: String(d.db ?? ""),
    collections: numFromExt(d.collections),
    objects: numFromExt(d.objects),
    dataSize: numFromExt(d.dataSize),
    storageSize: numFromExt(d.storageSize),
    indexes: numFromExt(d.indexes),
    indexSize: numFromExt(d.indexSize),
  };
}

export interface CollOptionsInfo {
  capped: boolean;
  size: number | null;
  max: number | null;
  validationLevel: string | null;
  validationAction: string | null;
  validatorJson: string | null;
  rawJson: string;
}

export function parseCollOptions(json: string): CollOptionsInfo {
  const d = JSON.parse(json) as Record<string, unknown>;
  const options = (d.options ?? {}) as Record<string, unknown>;
  const validator = options.validator;
  return {
    capped: options.capped === true,
    size: numFromExt(options.size),
    max: numFromExt(options.max),
    validationLevel: typeof options.validationLevel === "string" ? options.validationLevel : null,
    validationAction: typeof options.validationAction === "string" ? options.validationAction : null,
    validatorJson:
      validator && typeof validator === "object" ? JSON.stringify(validator, null, 2) : null,
    rawJson: JSON.stringify(options, null, 2),
  };
}
