/** Build equivalent mongosh command strings for the command log (read-only). Pure; no Tauri/Svelte. */

const c = (coll: string) => `db.getCollection("${coll}")`;

export function findCmd(p: {
  coll: string;
  filter?: string;
  projection?: string | null;
  sort?: string | null;
  skip?: number;
  limit?: number;
}): string {
  const filter = p.filter ?? "{}";
  let s = `${c(p.coll)}.find(${filter}`;
  if (p.projection) s += `, ${p.projection}`;
  s += ")";
  if (p.sort) s += `.sort(${p.sort})`;
  if (p.skip && p.skip > 0) s += `.skip(${p.skip})`;
  if (p.limit && p.limit > 0) s += `.limit(${p.limit})`;
  return s;
}

export const insertCmd = (coll: string, docJson: string) => `${c(coll)}.insertOne(${docJson})`;

export const replaceCmd = (coll: string, idJson: string, docJson: string) =>
  `${c(coll)}.replaceOne({ "_id": ${idJson} }, ${docJson})`;

export const deleteOneCmd = (coll: string, idJson: string) =>
  `${c(coll)}.deleteOne({ "_id": ${idJson} })`;

export const updateManyCmd = (coll: string, filterJson: string, updateJson: string) =>
  `${c(coll)}.updateMany(${filterJson}, ${updateJson})`;

export const deleteManyCmd = (coll: string, filterJson: string) =>
  `${c(coll)}.deleteMany(${filterJson})`;

export const updateOneCmd = (coll: string, filterJson: string, updateJson: string) =>
  `${c(coll)}.updateOne(${filterJson}, ${updateJson})`;

export const countCmd = (coll: string, filterJson: string) =>
  `${c(coll)}.countDocuments(${filterJson})`;

export const createCollectionCmd = (coll: string) => `db.createCollection("${coll}")`;

export const dropCollectionCmd = (coll: string) => `${c(coll)}.drop()`;

export const truncateCollectionCmd = (coll: string) => `${c(coll)}.deleteMany({})`;

export const renameCollectionCmd = (coll: string, to: string) =>
  `${c(coll)}.renameCollection("${to}")`;

export const duplicateCollectionCmd = (source: string, target: string) =>
  `${c(source)}.aggregate([{ "$out": "${target}" }])`;

export const dropDatabaseCmd = () => "db.dropDatabase()";

export function createIndexCmd(
  coll: string,
  keys: Record<string, unknown>,
  options?: Record<string, unknown>,
): string {
  const opts = options && Object.keys(options).length > 0 ? `, ${JSON.stringify(options)}` : "";
  return `${c(coll)}.createIndex(${JSON.stringify(keys)}${opts})`;
}

export const dropIndexCmd = (coll: string, name: string) => `${c(coll)}.dropIndex("${name}")`;

export const collStatsCmd = (coll: string) =>
  `${c(coll)}.aggregate([{ "$collStats": { "storageStats": {} } }])`;

export const dbStatsCmd = () => "db.stats()";

export const importCmd = (db: string, coll: string, path: string) =>
  `mongoimport --db ${db} --collection ${coll} --file "${path}"`;

export const exportBsonCmd = (db: string, coll: string, path: string) =>
  `mongodump --db ${db} --collection ${coll} --out "${path}"`;

export const connectCmd = (uri: string) => `mongosh "${uri}"`;

export const sampleCmd = (coll: string, size: number) =>
  `${c(coll)}.aggregate([{ "$sample": { "size": ${size} } }])`;

export const listIndexesCmd = (coll: string) => `${c(coll)}.getIndexes()`;

export const listDatabasesCmd = () => "show dbs";

export const findOneByIdCmd = (coll: string, idJson: string) =>
  `${c(coll)}.findOne({ "_id": ${idJson} })`;
