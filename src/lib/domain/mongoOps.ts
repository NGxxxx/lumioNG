/** Static MongoDB stage/operator catalogs for query autocomplete. Pure data, no deps. */

export interface OpEntry {
  label: string;
  detail?: string;
}

/** Aggregation pipeline stages (object-key position directly inside the pipeline array). */
export const PIPELINE_STAGES: readonly OpEntry[] = Object.freeze([
  { label: "$match", detail: "filter documents" },
  { label: "$group", detail: "group by expression" },
  { label: "$project", detail: "reshape fields" },
  { label: "$sort", detail: "order documents" },
  { label: "$limit", detail: "cap result count" },
  { label: "$skip", detail: "skip N documents" },
  { label: "$unwind", detail: "expand an array" },
  { label: "$lookup", detail: "join another collection" },
  { label: "$count", detail: "count documents" },
  { label: "$addFields", detail: "add computed fields" },
  { label: "$set", detail: "alias of $addFields" },
  { label: "$unset", detail: "remove fields" },
  { label: "$facet", detail: "multi-pipeline" },
  { label: "$bucket", detail: "group into buckets" },
  { label: "$replaceRoot", detail: "promote a subdocument" },
  { label: "$sample", detail: "random sample" },
  { label: "$sortByCount", detail: "group + count + sort" },
  { label: "$out", detail: "write to a collection" },
  { label: "$merge", detail: "merge into a collection" },
]);

/** Query/filter operators (inside a condition object, e.g. under $match). */
export const QUERY_OPERATORS: readonly OpEntry[] = Object.freeze([
  { label: "$eq", detail: "equals" },
  { label: "$ne", detail: "not equal" },
  { label: "$gt", detail: "greater than" },
  { label: "$gte", detail: "greater or equal" },
  { label: "$lt", detail: "less than" },
  { label: "$lte", detail: "less or equal" },
  { label: "$in", detail: "in array" },
  { label: "$nin", detail: "not in array" },
  { label: "$and", detail: "logical and" },
  { label: "$or", detail: "logical or" },
  { label: "$not", detail: "logical not" },
  { label: "$nor", detail: "logical nor" },
  { label: "$exists", detail: "field exists" },
  { label: "$type", detail: "BSON type" },
  { label: "$regex", detail: "regular expression" },
  { label: "$elemMatch", detail: "array element match" },
  { label: "$size", detail: "array length" },
  { label: "$all", detail: "all elements match" },
]);

/** Aggregation expression operators (value position inside expressions). */
export const EXPR_OPERATORS: readonly OpEntry[] = Object.freeze([
  { label: "$sum", detail: "sum" },
  { label: "$avg", detail: "average" },
  { label: "$min", detail: "minimum" },
  { label: "$max", detail: "maximum" },
  { label: "$first", detail: "first value" },
  { label: "$last", detail: "last value" },
  { label: "$push", detail: "append to array" },
  { label: "$concat", detail: "concat strings" },
  { label: "$toString", detail: "convert to string" },
  { label: "$dateToString", detail: "format a date" },
  { label: "$cond", detail: "conditional" },
  { label: "$ifNull", detail: "default if null" },
  { label: "$map", detail: "map over an array" },
  { label: "$filter", detail: "filter an array" },
]);

/** Collection methods the Query editor's Run can execute (offered after `db.<coll>.`).
 *  Deliberately omits the deprecated `count` alias even though Run still accepts it. */
export const COLLECTION_METHODS: readonly OpEntry[] = Object.freeze([
  { label: "find", detail: "query documents" },
  { label: "aggregate", detail: "run a pipeline" },
  { label: "countDocuments", detail: "count matching documents" },
  { label: "distinct", detail: "distinct values of a field" },
  { label: "insertOne", detail: "insert one document" },
  { label: "insertMany", detail: "insert many documents" },
  { label: "updateOne", detail: "update one document" },
  { label: "updateMany", detail: "update many documents" },
  { label: "replaceOne", detail: "replace one document" },
  { label: "deleteOne", detail: "delete one document" },
  { label: "deleteMany", detail: "delete many documents" },
]);

/** Cursor methods offered after a cursor-returning call (find(…)./aggregate(…). and chains). */
export const CURSOR_METHODS: readonly OpEntry[] = Object.freeze([
  { label: "sort", detail: "order documents" },
  { label: "limit", detail: "cap result count" },
  { label: "skip", detail: "skip N documents" },
  { label: "projection", detail: "select fields" },
  { label: "hint", detail: "force an index" },
  { label: "maxTimeMS", detail: "time limit (ms)" },
  { label: "count", detail: "count matching documents" },
  { label: "size", detail: "count after skip/limit" },
  { label: "toArray", detail: "materialize to an array" },
  { label: "forEach", detail: "iterate documents" },
  { label: "map", detail: "transform each document" },
  { label: "hasNext", detail: "are more documents available?" },
  { label: "next", detail: "advance to the next document" },
  { label: "explain", detail: "show the query plan" },
  { label: "pretty", detail: "mongosh compatibility (no-op — results are already formatted)" },
]);

/** Database-level methods offered after `db.` (alongside collection names). */
export const DB_METHODS: readonly OpEntry[] = Object.freeze([
  { label: "getCollection", detail: "collection by name" },
  { label: "getCollectionNames", detail: "list collection names" },
  { label: "getCollectionInfos", detail: "collection metadata" },
  { label: "runCommand", detail: "run a raw command" },
  { label: "adminCommand", detail: "run an admin command" },
  { label: "aggregate", detail: "database-level pipeline" },
  { label: "stats", detail: "database statistics" },
  { label: "createCollection", detail: "create a collection" },
  { label: "createView", detail: "create a view" },
  { label: "dropDatabase", detail: "drop the database" },
  { label: "version", detail: "server version" },
  { label: "hello", detail: "server hello" },
  { label: "serverStatus", detail: "server status" },
  { label: "currentOp", detail: "in-progress operations" },
]);
