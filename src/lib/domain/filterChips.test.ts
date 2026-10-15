import { describe, expect, it } from "vitest";
import {
  chipsFromFilter,
  filterFromChips,
  opsForType,
  parseQuickChip,
  canJoinOr,
  joinOr,
  type Chip,
} from "./filterChips";

const now = new Date(2026, 9, 15, 13, 30, 0); // local time
const c = (field: string, op: Chip["op"], ...values: string[]): Chip => ({ field, op, values });

describe("chipsFromFilter / filterFromChips per op", () => {
  const cases: [string, string, Chip][] = [
    ["eq string", '{"s": "shipped"}', c("s", "eq", '"shipped"')],
    ["eq number", '{"n": 5}', c("n", "eq", "5")],
    ["eq null", '{"n": null}', c("n", "eq", "null")],
    ["isTrue", '{"b": true}', c("b", "isTrue")],
    ["isFalse", '{"b": false}', c("b", "isFalse")],
    ["ne", '{"s": {"$ne": "x"}}', c("s", "ne", '"x"')],
    ["in", '{"s": {"$in": ["a", 2, {"$oid": "507f1f77bcf86cd799439011"}]}}',
      c("s", "in", '"a"', "2", '{"$oid": "507f1f77bcf86cd799439011"}')],
    ["exists", '{"s": {"$exists": true}}', c("s", "exists")],
    ["notExists", '{"s": {"$exists": false}}', c("s", "notExists")],
    ["gt", '{"n": {"$gt": 1}}', c("n", "gt", "1")],
    ["gte", '{"n": {"$gte": 1}}', c("n", "gte", "1")],
    ["lt", '{"n": {"$lt": 1}}', c("n", "lt", "1")],
    ["lte", '{"n": {"$lte": 1}}', c("n", "lte", "1")],
    ["between", '{"n": {"$gte": 1, "$lte": 9}}', c("n", "between", "1", "9")],
    ["contains", '{"s": {"$regex": "ann", "$options": "i"}}', c("s", "contains", '"ann"')],
    ["startsWith", '{"s": {"$regex": "^ann"}}', c("s", "startsWith", '"ann"')],
    ["size", '{"t": {"$size": 3}}', c("t", "size", "3")],
    ["before→lt", '{"d": {"$lt": {"$date": "2026-01-01T00:00:00.000Z"}}}',
      c("d", "lt", '{"$date": "2026-01-01T00:00:00.000Z"}')],
    ["after→gt", '{"d": {"$gt": {"$date": "2026-01-01T00:00:00.000Z"}}}',
      c("d", "gt", '{"$date": "2026-01-01T00:00:00.000Z"}')],
  ];
  for (const [name, text, chip] of cases) {
    it(`${name}: parses`, () => {
      const parsed = chipsFromFilter(text)!;
      expect(parsed).toEqual([chip]);
    });
  }
  // before/after parse as lt/gt only after mapping; chips for those ops build text
  const buildCases: [string, Chip, string][] = [
    ["before", c("d", "before", '{"$date":"2026-01-01T00:00:00.000Z"}'), '{"d": {"$lt": {"$date":"2026-01-01T00:00:00.000Z"}}}'],
    ["after", c("d", "after", '{"$date":"2026-01-01T00:00:00.000Z"}'), '{"d": {"$gt": {"$date":"2026-01-01T00:00:00.000Z"}}}'],
    ["elemMatch", c("t", "elemMatch", '"x"'), '{"t": "x"}'],
  ];
  for (const [name, chip, text] of buildCases) {
    it(`${name}: builds`, () => {
      expect(filterFromChips([chip])).toBe(text);
    });
  }
  for (const [name, text, chip] of cases) {
    if (name.includes("→")) continue;
    it(`${name}: builds parse-equal`, () => {
      expect(JSON.parse(filterFromChips([chip]))).toEqual(JSON.parse(text));
    });
  }

  it("emits the documented compact format", () => {
    expect(filterFromChips([c("a", "eq", "1"), c("b", "ne", "2")])).toBe('{"a": 1, "b": {"$ne": 2}}');
  });
  it("builds regexes with escaping and unescapes back", () => {
    const text = filterFromChips([c("s", "contains", '"a.b(c)"')]);
    expect(JSON.parse(text)).toEqual({ s: { $regex: "a\\.b\\(c\\)", $options: "i" } });
    expect(chipsFromFilter(text)).toEqual([c("s", "contains", '"a.b(c)"')]);
    const sw = filterFromChips([c("s", "startsWith", '"a+b"')]);
    expect(JSON.parse(sw)).toEqual({ s: { $regex: "^a\\+b" } });
    expect(chipsFromFilter(sw)).toEqual([c("s", "startsWith", '"a+b"')]);
  });
  it("builds isTrue/isFalse/exists/notExists", () => {
    expect(JSON.parse(filterFromChips([c("b", "isTrue"), c("x", "isFalse")]))).toEqual({ b: true, x: false });
    expect(JSON.parse(filterFromChips([c("b", "exists"), c("x", "notExists")]))).toEqual({
      b: { $exists: true },
      x: { $exists: false },
    });
  });
  it("builds lastDays relative to now", () => {
    const out = JSON.parse(filterFromChips([c("d", "lastDays", "7")], now));
    const expected = new Date(now.getTime());
    expected.setDate(expected.getDate() - 7);
    expect(out).toEqual({ d: { $gte: { $date: expected.toISOString() } } });
  });
  it("lastDays parses back as gte", () => {
    const text = filterFromChips([c("d", "lastDays", "7")], now);
    expect(chipsFromFilter(text)).toEqual([c("d", "gte", `{"$date": "${JSON.parse(text).d.$gte.$date}"}`)]);
  });
  it("builds today as local-day range and parses back as between", () => {
    const text = filterFromChips([c("d", "today")], now);
    const start = new Date(2026, 9, 15);
    const next = new Date(2026, 9, 16);
    expect(JSON.parse(text)).toEqual({
      d: { $gte: { $date: start.toISOString() }, $lt: { $date: next.toISOString() } },
    });
    // {$gte, $lt} parses back as a "between" chip that keeps its exclusive end
    const chips = chipsFromFilter(text)!;
    expect(chips).toEqual([
      { ...c("d", "between", `{"$date": "${start.toISOString()}"}`, `{"$date": "${next.toISOString()}"}`), upperExclusive: true },
    ]);
    expect(JSON.parse(filterFromChips(chips, now))).toEqual(JSON.parse(text));
  });
  it("never rewrites a $lt range end to $lte when another chip changes", () => {
    const chips = chipsFromFilter('{"age": {"$gte": 18, "$lt": 65}, "x": 1}')!;
    expect(filterFromChips(chips.slice(0, 1))).toBe('{"age": {"$gte": 18, "$lt": 65}}');
  });
  it("two chips on one field go into $and (no duplicate key) and parse back", () => {
    const chips = [c("age", "gt", "18"), c("s", "eq", '"a"'), c("age", "lt", "65")];
    const text = filterFromChips(chips);
    expect(text).toBe('{"$and": [{"age": {"$gt": 18}}, {"age": {"$lt": 65}}], "s": "a"}');
    expect(JSON.parse(text)).toEqual({ $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }], s: "a" });
    expect(chipsFromFilter(text)).toEqual([chips[0], chips[2], chips[1]]);
  });
  it("same-field 'or' joins is/in chips into one $in", () => {
    const chips = [c("s", "eq", '"a"'), c("s", "in", '"b"', '"a"'), c("n", "eq", "1")];
    expect(canJoinOr(chips[0], chips[1])).toBe(true);
    expect(canJoinOr(chips[1], chips[2])).toBe(false);
    expect(canJoinOr(c("n", "gt", "1"), c("n", "eq", "2"))).toBe(false);
    expect(joinOr(chips, 0)).toEqual([c("s", "in", '"a"', '"b"'), chips[2]]);
    expect(joinOr(chips, 1)).toBe(chips);
  });
  it("empty chips → {}", () => {
    expect(filterFromChips([])).toBe("{}");
  });
});

describe("chipsFromFilter shape", () => {
  it("empty and {} → []", () => {
    expect(chipsFromFilter("")).toEqual([]);
    expect(chipsFromFilter("  ")).toEqual([]);
    expect(chipsFromFilter("{}")).toEqual([]);
    expect(chipsFromFilter("{ }")).toEqual([]);
  });
  it("keeps key order across fields and dotted paths", () => {
    expect(chipsFromFilter('{"z": 1, "a.b": {"$ne": 2}}')).toEqual([c("z", "eq", "1"), c("a.b", "ne", "2")]);
  });
  it("accepts ExtJSON wrappers as eq values", () => {
    for (const w of ['{"$oid":"507f1f77bcf86cd799439011"}', '{"$date":"2026-01-01T00:00:00Z"}',
      '{"$numberLong":"9007199254740993"}', '{"$numberDecimal":"1.50"}', '{"$numberDouble":"1.5"}',
      '{"$numberInt":"3"}', '{"$regularExpression":{"pattern":"a","options":"i"}}']) {
      expect(chipsFromFilter(`{"f": ${w}}`)).toEqual([c("f", "eq", w)]);
    }
  });
  it("accepts array eq values as raw text", () => {
    expect(chipsFromFilter('{"t": ["a","b"]}')).toEqual([c("t", "eq", '["a","b"]')]);
  });
  it("ExtJSON in in/range operators keeps raw text", () => {
    expect(chipsFromFilter('{"d": {"$gte": {"$date":"2026-01-01T00:00:00Z"}, "$lte": {"$date":"2026-02-01T00:00:00Z"}}}'))
      .toEqual([c("d", "between", '{"$date":"2026-01-01T00:00:00Z"}', '{"$date":"2026-02-01T00:00:00Z"}')]);
  });
  it("between accepts $lte before $gte", () => {
    expect(chipsFromFilter('{"n": {"$lte": 9, "$gte": 1}}')).toEqual([c("n", "between", "1", "9")]);
  });
});

describe("chipsFromFilter rejections", () => {
  const bad: [string, string][] = [
    ["$expr", '{"$expr": {"$gt": ["$a", 1]}}'],
    ["$where", '{"$where": "this.a > 1"}'],
    ["$text", '{"$text": {"$search": "x"}}'],
    ["$or", '{"$or": [{"a": 1}, {"b": 2}]}'],
    ["$and with operator element", '{"$and": [{"$or": []}]}'],
    ["$and element with two fields", '{"$and": [{"a": 1, "b": 2}]}'],
    ["$and field also outside", '{"a": 1, "$and": [{"a": 2}]}'],
    ["$and not an array", '{"$and": {"a": 1}}'],
    ["$nor", '{"$nor": [{"a": 1}]}'],
    ["unknown operator", '{"a": {"$mod": [2, 0]}}'],
    ["operator plus unknown", '{"a": {"$gt": 1, "$mod": [2, 0]}}'],
    ["two comparisons not a range", '{"a": {"$gt": 1, "$lt": 5}}'],
    ["regex option other than i", '{"a": {"$regex": "x", "$options": "m"}}'],
    ["regex option is", '{"a": {"$regex": "x", "$options": "is"}}'],
    ["regex without options not anchored", '{"a": {"$regex": "x"}}'],
    ["real regex pattern", '{"a": {"$regex": "a.*b", "$options": "i"}}'],
    ["nested plain object", '{"a": {"b": 1}}'],
    ["nested object mixing $ and plain", '{"a": {"$gt": 1, "b": 2}}'],
    ["duplicate key", '{"a": 1, "a": 2}'],
    ["invalid json", '{"a": '],
    ["not an object", "[1]"],
    ["$exists non-boolean", '{"a": {"$exists": 1}}'],
    ["$in non-array", '{"a": {"$in": 1}}'],
    ["$options alone", '{"a": {"$options": "i"}}'],
  ];
  for (const [name, text] of bad) {
    it(`rejects ${name}`, () => expect(chipsFromFilter(text)).toBeNull());
  }
});

describe("round trip keeps value text", () => {
  const texts = [
    '{"n": 9007199254740993}',
    '{"n": 1.0}',
    '{"id": {"$oid": "507f1f77bcf86cd799439011"}}',
    '{"d": {"$date": "2026-01-01T00:00:00Z"}}',
    '{"n": {"$in": [9007199254740993, 1.0]}}',
    '{"n": {"$gte": 1.0, "$lte": 9007199254740993}}',
    '{"a": "x", "b": {"$ne": 2.50}, "c": {"$exists": true}, "s": {"$regex": "a\\\\.b", "$options": "i"}}',
  ];
  for (const t of texts) {
    it(t, () => {
      const chips = chipsFromFilter(t)!;
      const out = filterFromChips(chips);
      expect(JSON.parse(out)).toEqual(JSON.parse(t));
      for (const raw of ["9007199254740993", "1.0", "2.50", '{"$oid": "507f1f77bcf86cd799439011"}', '{"$date": "2026-01-01T00:00:00Z"}']) {
        if (t.includes(raw)) expect(out).toContain(raw);
      }
    });
  }
});

describe("parseQuickChip", () => {
  it("leading-zero digits stay a string (valid JSON)", () => {
    expect(parseQuickChip("zip:01234")).toEqual(c("zip", "eq", '"01234"'));
    expect(() => JSON.parse(filterFromChips([parseQuickChip("zip:01234")!]))).not.toThrow();
  });
  it("uses the field's type: ObjectId hex becomes $oid, digits on a string field stay text", () => {
    const types: Record<string, "objectId" | "string"> = { _id: "objectId", code: "string" };
    const typeOf = (f: string) => types[f] ?? "unknown";
    expect(parseQuickChip("_id:65A1b2c3d4e5f60718293a4b", typeOf)).toEqual(c("_id", "eq", '{"$oid":"65a1b2c3d4e5f60718293a4b"}'));
    expect(parseQuickChip("code:42", typeOf)).toEqual(c("code", "eq", '"42"'));
    expect(parseQuickChip("_id:[65a1b2c3d4e5f60718293a4b, nothex]", typeOf)!.values).toEqual(['{"$oid":"65a1b2c3d4e5f60718293a4b"}', '"nothex"']);
  });
  it("eq with literals and strings", () => {
    expect(parseQuickChip("status:shipped")).toEqual(c("status", "eq", '"shipped"'));
    expect(parseQuickChip(" status : shipped ")).toEqual(c("status", "eq", '"shipped"'));
    expect(parseQuickChip("n:5")).toEqual(c("n", "eq", "5"));
    expect(parseQuickChip("n:1.0")).toEqual(c("n", "eq", "1.0"));
    expect(parseQuickChip("b:true")).toEqual(c("b", "eq", "true"));
    expect(parseQuickChip("b:null")).toEqual(c("b", "eq", "null"));
    expect(parseQuickChip('s:"hello world"')).toEqual(c("s", "eq", '"hello world"'));
    expect(parseQuickChip("s:hello world")).toEqual(c("s", "eq", '"hello world"'));
    expect(parseQuickChip('id:{"$oid":"507f1f77bcf86cd799439011"}')).toEqual(
      c("id", "eq", '{"$oid":"507f1f77bcf86cd799439011"}'),
    );
  });
  it("comparisons", () => {
    expect(parseQuickChip("total>100")).toEqual(c("total", "gt", "100"));
    expect(parseQuickChip("total>=100")).toEqual(c("total", "gte", "100"));
    expect(parseQuickChip("total<100")).toEqual(c("total", "lt", "100"));
    expect(parseQuickChip("total <= 100")).toEqual(c("total", "lte", "100"));
    expect(parseQuickChip("total!=100")).toEqual(c("total", "ne", "100"));
    expect(parseQuickChip("s!=x")).toEqual(c("s", "ne", '"x"'));
  });
  it("contains and in", () => {
    expect(parseQuickChip("name~ann")).toEqual(c("name", "contains", '"ann"'));
    expect(parseQuickChip("name~123")).toEqual(c("name", "contains", '"123"'));
    expect(parseQuickChip("tags:[a,b]")).toEqual(c("tags", "in", '"a"', '"b"'));
    expect(parseQuickChip("n:[1, 2]")).toEqual(c("n", "in", "1", "2"));
  });
  it("dotted fields", () => {
    expect(parseQuickChip("a.b.c:1")).toEqual(c("a.b.c", "eq", "1"));
  });
  it("invalid → null", () => {
    for (const s of ["", "  ", "abc", ":x", "a:", "a>", "a~", ">5", "a=b", "a:[]", "a:[x,]", "a b:c"]) {
      expect(parseQuickChip(s), s).toBeNull();
    }
  });
});

describe("opsForType", () => {
  it("lists per type", () => {
    expect(opsForType("string")).toEqual(["eq", "ne", "contains", "startsWith", "in", "exists", "notExists"]);
    expect(opsForType("number")).toEqual(["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "exists", "notExists"]);
    expect(opsForType("date")).toEqual(["lastDays", "before", "after", "between", "today", "exists", "notExists"]);
    expect(opsForType("array")).toEqual(["elemMatch", "size", "exists", "notExists"]);
    expect(opsForType("bool")).toEqual(["isTrue", "isFalse", "exists", "notExists"]);
    expect(opsForType("objectId")).toEqual(["eq", "ne", "in", "exists", "notExists"]);
    expect(opsForType("unknown")).toEqual(["eq", "ne", "exists", "notExists"]);
  });
});
