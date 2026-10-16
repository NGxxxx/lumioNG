/** Ready-made statements for the Query editor, written against one collection. Every method used is
 *  one the script engine's prelude implements; `field`/`value` are placeholders to overwrite. */
export interface QueryTemplate {
  /** Also the message-key suffix for its label: `query_template_<id>`. */
  id: string;
  text: string;
}

export function queryTemplates(coll: string): QueryTemplate[] {
  const c = `db.getCollection(${JSON.stringify(coll)})`;
  return [
    { id: "find", text: `${c}.find({ "field": "value" })\n  .sort({ "_id": -1 })\n  .limit(20)` },
    { id: "date_range", text: `${c}.find({\n  "createdAt": { "$gte": ISODate("2024-01-01"), "$lt": ISODate("2024-02-01") }\n})` },
    { id: "missing", text: `${c}.find({ "field": { "$exists": false } })` },
    { id: "group_count", text: `${c}.aggregate([\n  { "$group": { "_id": "$field", "count": { "$sum": 1 } } },\n  { "$sort": { "count": -1 } }\n])` },
    { id: "duplicates", text: `${c}.aggregate([\n  { "$group": { "_id": "$field", "count": { "$sum": 1 }, "ids": { "$push": "$_id" } } },\n  { "$match": { "count": { "$gt": 1 } } }\n])` },
    { id: "lookup", text: `${c}.aggregate([\n  { "$lookup": { "from": "other", "localField": "otherId", "foreignField": "_id", "as": "other" } },\n  { "$limit": 20 }\n])` },
    { id: "distinct", text: `${c}.distinct("field")` },
    { id: "update_many", text: `${c}.updateMany(\n  { "field": "old" },\n  { "$set": { "field": "new" } }\n)` },
    { id: "indexes", text: `${c}.getIndexes()` },
    { id: "stats", text: `${c}.stats()` },
  ];
}

/** How to insert a template over `doc[from, to)` so it sits on its own lines, a blank line apart from
 *  any neighbouring code. */
export function templateInsertion(doc: string, from: number, to: number, text: string): { insert: string; cursor: number } {
  const before = doc.slice(0, from);
  const after = doc.slice(to);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insert = `${lead}${text}${trail}`;
  return { insert, cursor: from + lead.length + text.length };
}
