import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("../api/csfle", () => ({
  csfleListKeys: vi.fn(async () => [{ id: "k1", keyAltNames: ["pii"], provider: "local" }]),
  csfleCreateDataKey: vi.fn(),
  csfleEncrypt: vi.fn(async () => '{"$binary":{"base64":"AQ==","subType":"06"}}'),
}));
import * as api from "../api/csfle";
import EncryptValueDialog from "./EncryptValueDialog.svelte";

beforeEach(() => vi.clearAllMocks());

describe("EncryptValueDialog", () => {
  it("encrypts the field value with the chosen key and algorithm", async () => {
    const onencrypted = vi.fn();
    const { findByText, getByLabelText, getByText } = render(EncryptValueDialog, {
      props: { sessionId: "s1", fieldPath: "user.ssn", value: "123-45", onencrypted, oncancel: vi.fn() },
    });
    await findByText("pii (local)");
    expect(getByText("Field: user.ssn")).toBeTruthy();
    await fireEvent.change(getByLabelText(/Algorithm/), { target: { value: "random" } });
    await fireEvent.click(getByText("Encrypt"));
    await waitFor(() => expect(onencrypted).toHaveBeenCalled());
    expect(api.csfleEncrypt).toHaveBeenCalledWith("s1", '"123-45"', { keyId: "k1", keyAltName: null }, "random");
    expect(onencrypted).toHaveBeenCalledWith({ $binary: { base64: "AQ==", subType: "06" } });
  });

  it("shows the backend error and does not report success", async () => {
    vi.mocked(api.csfleEncrypt).mockRejectedValueOnce({ kind: "Query", message: "Encryption: key not found" });
    const onencrypted = vi.fn();
    const { findByText, getByText } = render(EncryptValueDialog, {
      props: { sessionId: "s1", fieldPath: "a", value: 1, onencrypted, oncancel: vi.fn() },
    });
    await findByText("pii (local)");
    await fireEvent.click(getByText("Encrypt"));
    expect(await findByText(/key not found/)).toBeTruthy();
    expect(onencrypted).not.toHaveBeenCalled();
  });

  it("offers key creation when the key vault is empty", async () => {
    vi.mocked(api.csfleListKeys).mockResolvedValueOnce([]);
    const { findByText } = render(EncryptValueDialog, { props: { sessionId: "s1", fieldPath: "a", value: 1, onencrypted: vi.fn(), oncancel: vi.fn() } });
    expect(await findByText(/no data keys yet/)).toBeTruthy();
    expect(await findByText("Create key")).toBeTruthy();
  });
});
