import { describe, it, expect } from "vitest";
import { queryTemplates, templateInsertion } from "./queryTemplates";
import { methodHeadAt } from "./queryStatement";
import en from "../../../messages/en.json";

describe("queryTemplates", () => {
  const list = queryTemplates("orders");

  it("every template is valid JavaScript", () => {
    for (const t of list) expect(() => new Function(t.text), t.id).not.toThrow();
  });

  it("every template targets the given collection", () => {
    for (const t of list) expect(t.text.startsWith('db.getCollection("orders").'), t.id).toBe(true);
  });

  it("collection names are quoted safely", () => {
    const [t] = queryTemplates('we"ird');
    expect(() => new Function(t.text)).not.toThrow();
    expect(t.text).toContain('db.getCollection("we\\"ird")');
  });

  it("autocomplete still recognizes the statement", () => {
    expect(methodHeadAt(list[0].text, list[0].text.length)?.coll).toBe("orders");
  });

  it("every template has a label message", () => {
    for (const t of list) expect(en, t.id).toHaveProperty(`query_template_${t.id}`);
  });
});

describe("templateInsertion", () => {
  it("into an empty editor: just the text", () => {
    expect(templateInsertion("", 0, 0, "X")).toEqual({ insert: "X", cursor: 1 });
  });

  it("after existing code: separated by a blank line", () => {
    expect(templateInsertion("a()", 3, 3, "X")).toEqual({ insert: "\n\nX", cursor: 6 });
    expect(templateInsertion("a()\n", 4, 4, "X")).toEqual({ insert: "\nX", cursor: 6 });
  });

  it("in the middle of a line: the rest moves to its own line", () => {
    expect(templateInsertion("ab", 1, 1, "X")).toEqual({ insert: "\n\nX\n\n", cursor: 4 });
    expect(templateInsertion("a\nb", 2, 2, "X")).toEqual({ insert: "\nX\n\n", cursor: 4 });
  });

  it("replaces a selection", () => {
    expect(templateInsertion("old", 0, 3, "X")).toEqual({ insert: "X", cursor: 1 });
  });
});
