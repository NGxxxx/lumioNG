import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("../api/documents", () => ({ sampleDocuments: vi.fn(), countDocuments: vi.fn() }));
import * as docs from "../api/documents";
import { createValidatorEditor } from "../stores/validatorEditor.svelte";
import ValidatorEditor from "./ValidatorEditor.svelte";

const sample = docs.sampleDocuments as ReturnType<typeof vi.fn>;
const count = docs.countDocuments as ReturnType<typeof vi.fn>;

function setup(json: string | null = null) {
  const save = vi.fn(async (..._a: unknown[]) => true);
  const ed = createValidatorEditor({ sessionId: "s1", db: "d", coll: "c", validatorJson: json, level: "strict", action: "error", save });
  const open = vi.fn();
  const r = render(ValidatorEditor, { props: { ed, saving: false, saveError: null, oncancel: vi.fn(), onopenviolators: open } });
  return { ed, save, open, ...r };
}
const jsonOf = (c: HTMLElement) => JSON.parse((c.querySelector("textarea.validator-json") as HTMLTextAreaElement).value);

describe("ValidatorEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tree edit -> JSON", async () => {
    const { container, getByText, getByPlaceholderText } = setup(JSON.stringify({ $jsonSchema: { bsonType: "object" } }));
    await fireEvent.input(getByPlaceholderText("Field name"), { target: { value: "email" } });
    await fireEvent.click(getByText("Add field"));
    await fireEvent.click(getByText("email"));
    await fireEvent.click(container.querySelector('input[data-type="int"]')!);
    await fireEvent.click(container.querySelector(".f-required")!);
    await fireEvent.click(getByText("JSON"));
    const v = jsonOf(container);
    expect(v.$jsonSchema.properties.email.bsonType).toEqual(["string", "int"]);
    expect(v.$jsonSchema.required).toEqual(["email"]);
  });

  it("JSON edit -> tree, and invalid JSON keeps the tree and shows the error", async () => {
    const { container, getByText, queryByText } = setup(null);
    await fireEvent.click(getByText("JSON"));
    const ta = container.querySelector("textarea.validator-json") as HTMLTextAreaElement;
    await fireEvent.input(ta, { target: { value: '{"$jsonSchema":{"bsonType":"object","properties":{"age":{"bsonType":"int"}}}}' } });
    await fireEvent.click(getByText("Fields"));
    expect(getByText("age")).toBeTruthy();
    await fireEvent.click(getByText("JSON"));
    await fireEvent.input(container.querySelector("textarea.validator-json")!, { target: { value: "{ bad" } });
    expect(container.querySelector(".json-error")).toBeTruthy();
    await fireEvent.click(getByText("Fields"));
    expect(queryByText("age")).toBeTruthy();
  });

  it("Create from sample fills the tree", async () => {
    sample.mockResolvedValue([{ _id: { $oid: "a".repeat(24) }, name: "x" }, { _id: { $oid: "b".repeat(24) }, name: "y" }]);
    const { getByText } = setup(null);
    await fireEvent.click(getByText("Create from sample data"));
    await waitFor(() => expect(getByText("name")).toBeTruthy());
    expect(getByText("_id")).toBeTruthy();
  });

  it("Test on data shows the violator count and opens the violators query", async () => {
    count.mockResolvedValue(3);
    const { getByText, open } = setup(JSON.stringify({ $jsonSchema: { bsonType: "object" } }));
    await fireEvent.click(getByText("Test on data"));
    await waitFor(() => expect(getByText("3 documents violate the schema")).toBeTruthy());
    await fireEvent.click(getByText("Open first 20 violators"));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("$nor"));
  });
});
