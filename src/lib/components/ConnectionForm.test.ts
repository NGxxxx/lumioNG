import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "keychain"),
  listConnections: vi.fn().mockResolvedValue([]),
  saveConnection: vi.fn().mockResolvedValue([]),
  deleteConnection: vi.fn().mockResolvedValue([]),
  touchConnection: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/connection", () => ({ testConnection: vi.fn(), forgetSshHostKey: vi.fn() }));
vi.mock("../api/files", () => ({ openDialog: vi.fn() }));

import ConnectionForm from "./ConnectionForm.svelte";
import { createConnectionRegistry } from "../stores/connections.svelte";

function setup() {
  const r = createConnectionRegistry();
  const utils = render(ConnectionForm, { props: { registry: r, connectError: null } });
  return { r, ...utils };
}

describe("ConnectionForm — environment & color", () => {
  it("the Environment control sets the registry value", async () => {
    const { r, getByRole } = setup();
    const group = getByRole("radiogroup", { name: "Environment" });
    await fireEvent.click(group.querySelector('[data-env="staging"]')!);
    expect(r.environment).toBe("staging");
  });

  it("a production-looking name suggests PROD; one click applies it", async () => {
    const { r, getByLabelText, getByRole } = setup();
    await fireEvent.input(getByLabelText("Session name"), { target: { value: "prod-cluster" } });
    await fireEvent.click(getByRole("button", { name: /mark as PROD/ }));
    expect(r.environment).toBe("prod");
  });

  it("no suggestion once the user picked a value", async () => {
    const { getByLabelText, getByRole, queryByRole } = setup();
    await fireEvent.click(getByRole("radiogroup", { name: "Environment" }).querySelector('[data-env="dev"]')!);
    await fireEvent.input(getByLabelText("Session name"), { target: { value: "prod-cluster" } });
    expect(queryByRole("button", { name: /mark as PROD/ })).toBeNull();
  });

  it("PROD without read-only shows the read-only hint", async () => {
    const { r, getByRole, findByText, queryByText } = setup();
    await fireEvent.click(getByRole("radiogroup", { name: "Environment" }).querySelector('[data-env="prod"]')!);
    expect(await findByText(/Consider enabling read-only/)).toBeTruthy();
    r.readOnly = true;
    await Promise.resolve();
    await new Promise((res) => setTimeout(res));
    expect(queryByText(/Consider enabling read-only/)).toBeNull();
  });

  it("color swatches set the color; Automatic clears it", async () => {
    const { r, getByRole } = setup();
    const group = getByRole("radiogroup", { name: "Color" });
    const swatches = group.querySelectorAll("button");
    expect(swatches.length).toBe(7);
    await fireEvent.click(swatches[1]);
    expect(r.color).not.toBe("");
    await fireEvent.click(getByRole("radio", { name: "Automatic" }));
    expect(r.color).toBe("");
  });
});

describe("ConnectionForm — connection string", () => {
  it("pasting a URI fills the form and offers Undo", async () => {
    const { r, getByLabelText, getByText, getByRole } = setup();
    const input = getByLabelText("Connection string");
    await fireEvent.paste(input, { clipboardData: { getData: () => "mongodb+srv://u:p@cluster0.abc.mongodb.net/?replicaSet=x" } });
    expect(r.host).toBe("cluster0.abc.mongodb.net");
    expect(getByText(/Filled \d+ fields from the URI/)).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Undo" }));
    expect(r.host).toBe("localhost");
  });

  it("an invalid URI shows an error and leaves the form alone", async () => {
    const { r, getByLabelText, getByText } = setup();
    const input = getByLabelText("Connection string");
    await fireEvent.input(input, { target: { value: "not a uri" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(getByText("Not a valid connection string")).toBeTruthy();
    expect(r.host).toBe("localhost");
  });

  it("Copy URI is offered for a saved connection, without and with the password", async () => {
    const { r, getByRole, queryByRole } = setup();
    expect(queryByRole("button", { name: "Copy URI" })).toBeNull();
    r.edit({ id: 2, label: "x", scheme: "mongodb", host: "h", port: 27017, authMethod: "password", user: "bob", passwordEnc: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", readOnly: false, tlsCertificateKeyFile: "", tlsCertificateKeyFilePasswordEnc: "", sshEnabled: false, sshHost: "", sshPort: 22, sshUser: "", sshAuthMethod: "password", sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "", environment: "", color: "" });
    r.password = "pw";
    await Promise.resolve();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await fireEvent.click(getByRole("button", { name: "Copy URI" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain("pw@");
    await fireEvent.click(getByRole("button", { name: "Copy URI with password" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toContain("bob:pw@");
  });
});

describe("ConnectionForm — where passwords are stored", () => {
  it("says passwords go to the system keychain when one is available", async () => {
    const { r, getByLabelText, findByText } = setup();
    await r.load();
    await fireEvent.change(getByLabelText("Authentication:"), { target: { value: "password" } });
    expect(await findByText(/kept in the system keychain/)).toBeTruthy();
  });

  it("warns when it falls back to the settings file", async () => {
    const { getSecretStorage } = await import("../api/connections");
    vi.mocked(getSecretStorage).mockResolvedValueOnce("file");
    const { r, getByLabelText, findByText } = setup();
    await r.load();
    await fireEvent.change(getByLabelText("Authentication:"), { target: { value: "password" } });
    expect((await findByText(/System keychain unavailable/)).classList.contains("warn")).toBe(true);
  });
});
