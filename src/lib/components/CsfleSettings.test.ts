import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("../api/csfle", () => ({
  csfleGet: vi.fn(async () => ({ config: { enabled: false, keyVaultNamespace: "encryption.__keyVault", providers: [], cryptSharedLibPath: "" }, storedProviders: [] })),
  csfleSave: vi.fn(async () => "keychain"),
  csfleGenerateLocalKey: vi.fn(),
}));
vi.mock("../stores/desktop", () => ({ pickAnyFile: vi.fn(async () => "/keys/master.key"), pickSavePath: vi.fn(async () => "/keys/new.key") }));

import * as api from "../api/csfle";
import CsfleSettings from "./CsfleSettings.svelte";

beforeEach(() => vi.clearAllMocks());

describe("CsfleSettings", () => {
  it("asks to save the connection first when it has no id", () => {
    const { getByText, queryByLabelText } = render(CsfleSettings, { props: { connectionId: null } });
    expect(getByText(/Save the connection first/)).toBeTruthy();
    expect(queryByLabelText("Key vault")).toBeNull();
  });

  it("enables the local provider with a chosen key file and saves it", async () => {
    const { getByLabelText, getByText, findByLabelText } = render(CsfleSettings, { props: { connectionId: 5 } });
    await waitFor(() => expect(api.csfleGet).toHaveBeenCalledWith(5));
    await fireEvent.click(getByLabelText("Decrypt on read"));
    await fireEvent.click(getByLabelText("Local key file"));
    expect((getByText("Save encryption settings") as HTMLButtonElement).disabled).toBe(true); // key file still missing
    await fireEvent.click((await findByLabelText("Master key file")).parentElement!.querySelector("button")!);
    await waitFor(() => expect((getByLabelText("Master key file") as HTMLInputElement).value).toBe("/keys/master.key"));
    await fireEvent.click(getByText("Save encryption settings"));
    await waitFor(() => expect(api.csfleSave).toHaveBeenCalled());
    const [id, config, kms] = vi.mocked(api.csfleSave).mock.calls[0];
    expect(id).toBe(5);
    expect(config).toMatchObject({ enabled: true, providers: ["local"], keyVaultNamespace: "encryption.__keyVault" });
    expect(kms).toEqual({ localKeyFile: "/keys/master.key" });
  });

  it("keeps secret inputs as password fields and never prefills them", async () => {
    vi.mocked(api.csfleGet).mockResolvedValueOnce({ config: { enabled: true, keyVaultNamespace: "kv.keys", providers: ["aws"], cryptSharedLibPath: "" }, storedProviders: ["aws"] });
    const { findByLabelText } = render(CsfleSettings, { props: { connectionId: 2 } });
    const secret = (await findByLabelText("Secret access key")) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
    expect(secret.placeholder).toMatch(/keep the stored/);
  });
});
