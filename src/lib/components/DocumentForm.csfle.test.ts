import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import DocumentForm from "./DocumentForm.svelte";
import * as documents from "../api/documents";
import * as csfle from "../api/csfle";
import { disposeFieldSuggestions } from "../stores/fieldSuggestions";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn(),
  replaceDocument: vi.fn(async () => undefined),
  fetchFullDoc: vi.fn(async () => null),
  sampleDocuments: vi.fn(async () => []),
}));
vi.mock("../api/csfle", () => ({
  csfleSessionEnabled: vi.fn(async () => true),
  csfleEncryptedPaths: vi.fn(async () => ["ssn"]),
  csfleListKeys: vi.fn(async () => [{ id: "k1", keyAltNames: ["pii"], provider: "local" }]),
  csfleCreateDataKey: vi.fn(),
  csfleEncrypt: vi.fn(async () => '{"$binary":{"base64":"AQID","subType":"06"}}'),
}));
vi.mock("../domain/docid", () => ({ idJson: vi.fn(() => '{"$oid":"abc"}') }));
vi.mock("../stores/sessionManager.svelte", () => ({ sessionManager: { active: { id: "sess1", environment: "" } } }));

let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => { if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor); };
});
afterAll(() => restoreOffsetHeight?.());
beforeEach(() => { vi.clearAllMocks(); disposeFieldSuggestions("sess1"); });

const initial = { _id: { $oid: "507f1f77bcf86cd799439011" }, ssn: "123-45" };

describe("DocumentForm — client-side field level encryption", () => {
  it("encrypts a field with the chosen key and saves the BinData through the normal replace path", async () => {
    const onsaved = vi.fn();
    const { findAllByLabelText, findByText, getByText } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved, oncancel: () => {} },
    });
    await fireEvent.click((await findAllByLabelText("Encrypt with key…"))[0]);
    await findByText("pii (local)");
    await fireEvent.click(getByText("Encrypt"));
    await waitFor(() => expect(csfle.csfleEncrypt).toHaveBeenCalledWith("sess1", '"123-45"', { keyId: "k1", keyAltName: null }, "deterministic"));
    await fireEvent.click(getByText("Save"));
    await waitFor(() => expect(documents.replaceDocument).toHaveBeenCalled());
    const json = vi.mocked(documents.replaceDocument).mock.calls[0].at(-1) as string;
    expect(JSON.parse(json).ssn).toEqual({ $binary: { base64: "AQID", subType: "06" } });
    expect(onsaved).toHaveBeenCalled();
  });

  it("marks encrypted paths with a badge", async () => {
    const { findByText } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved: vi.fn(), oncancel: () => {} },
    });
    expect(await findByText("Encrypted")).toBeTruthy();
    expect(csfle.csfleEncryptedPaths).toHaveBeenCalledWith("sess1", "d", "c", '{"$oid":"abc"}');
  });

  it("a duplicate (insert from a source) marks its ciphertext paths with the Encrypted badge", async () => {
    const dup = { name: "Ann", ssn: { $binary: { base64: "AQID", subType: "06" } } };
    const { findByText } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: dup, onsaved: vi.fn(), oncancel: () => {} },
    });
    expect(await findByText("Encrypted")).toBeTruthy();
    expect(csfle.csfleEncryptedPaths).not.toHaveBeenCalled(); // no _id to look up: read from the form's own document
  });

  it("a save that would store plain text asks first and then sends the confirmed paths", async () => {
    vi.mocked(documents.replaceDocument)
      .mockRejectedValueOnce({ kind: "Query", message: "csfle_plaintext_required:ssn" })
      .mockResolvedValue(undefined);
    const onsaved = vi.fn();
    const { findByText, getByText, queryByText } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved, oncancel: () => {} },
    });
    await findByText("Encrypted");
    await fireEvent.click(getByText("Save"));
    await findByText("Store as plain text"); // the gate's dialog
    expect(onsaved).not.toHaveBeenCalled();
    await fireEvent.click(getByText("Store as plain text"));
    await waitFor(() => expect(onsaved).toHaveBeenCalled());
    expect(vi.mocked(documents.replaceDocument).mock.calls[1].at(-1)).toEqual(["ssn"]);
    expect(queryByText("Store as plain text")).toBeNull();
  });

  it("warns in edit mode that decrypted fields are saved as plain text", async () => {
    const { findByTestId } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved: vi.fn(), oncancel: () => {} },
    });
    expect((await findByTestId("csfle-edit-warning")).textContent).toMatch(/plain text/);
  });

  it("offers no encryption when the session was opened without it", async () => {
    vi.mocked(csfle.csfleSessionEnabled).mockResolvedValue(false);
    const { queryAllByLabelText, queryByTestId } = render(DocumentForm, {
      props: { mode: "edit", db: "d", coll: "c", initial, onsaved: vi.fn(), oncancel: () => {} },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(queryAllByLabelText("Encrypt with key…")).toHaveLength(0);
    expect(queryByTestId("csfle-edit-warning")).toBeNull();
  });
});
