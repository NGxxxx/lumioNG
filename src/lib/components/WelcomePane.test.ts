import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

const saved = (id: number, label: string, lastConnectedAt: number | null) => ({
  id, label, scheme: "mongodb", host: `${label.toLowerCase()}.local`, port: 27017, authMethod: "none", user: "",
  passwordEnc: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", readOnly: false,
  tlsCertificateKeyFile: "", tlsCertificateKeyFilePasswordEnc: "", sshEnabled: false, sshHost: "", sshPort: 22,
  sshUser: "", sshAuthMethod: "password", sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "", proxyType: "none", proxyHost: "", proxyPort: null, proxyUser: "", proxyPasswordEnc: "", awsSessionTokenEnc: "", gssapiServiceName: "", gssapiServiceRealm: "", gssapiCanonicalize: "", oidcMode: "", oidcEnvironment: "", oidcTokenResource: "",
  environment: "", color: "", lastConnectedAt,
});

vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "keychain"),
  listConnections: vi.fn(async () => [saved(1, "Old", 100), saved(2, "Fresh", 200), saved(3, "Never", null)]),
  saveConnection: vi.fn(), deleteConnection: vi.fn(), touchConnection: vi.fn(),
}));
vi.mock("../api/connection", () => ({ testConnection: vi.fn() }));

import WelcomePane from "./WelcomePane.svelte";
import type { ConnectRequest } from "../stores/connections.svelte";

describe("WelcomePane", () => {
  let onconnected: Mock<(c: ConnectRequest) => Promise<boolean>>;
  let onnewconnection: Mock<() => void>;
  beforeEach(() => {
    onconnected = vi.fn(async () => true);
    onnewconnection = vi.fn();
  });

  it("lists saved connections most recent first and connects one with a click", async () => {
    const { container, findByText } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    await findByText("Fresh");
    const labels = [...container.querySelectorAll(".conn .label")].map((e) => e.textContent);
    expect(labels).toEqual(["Fresh", "Old", "Never"]);
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".conn")[0]);
    expect(onconnected).toHaveBeenCalledWith(expect.objectContaining({ connId: 2, label: "Fresh", uri: "mongodb://fresh.local:27017/" }));
  });

  it("connects an ad-hoc pasted connection string", async () => {
    const { container } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    const input = container.querySelector(".paste input") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "mongodb://alice:pw@db.example:27018/?authSource=admin" } });
    await fireEvent.submit(container.querySelector("form.paste")!);
    expect(onconnected).toHaveBeenCalledWith(expect.objectContaining({ connId: null }));
    expect(onconnected.mock.calls[0][0].uri).toContain("db.example:27018");
  });

  it("rejects a paste that isn't a connection string", async () => {
    const { container, findByRole } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    const input = container.querySelector(".paste input") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "hello" } });
    await fireEvent.submit(container.querySelector("form.paste")!);
    expect((await findByRole("alert")).textContent).toMatch(/connection string/);
    expect(onconnected).not.toHaveBeenCalled();
  });

  it("shows an error when the connection fails", async () => {
    onconnected = vi.fn(async (_c: ConnectRequest) => false);
    const { container, findByText, findByRole } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    await findByText("Fresh");
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".conn")[0]);
    await waitFor(async () => expect((await findByRole("alert")).textContent).toMatch(/Connection failed/));
  });

  it("New connection opens the session manager", async () => {
    const { getByText } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    await fireEvent.click(getByText("New connection…"));
    expect(onnewconnection).toHaveBeenCalled();
  });

  it("lists the key shortcuts with their actual key combos", () => {
    const { getByText } = render(WelcomePane, { props: { onconnected, onnewconnection } });
    expect(getByText("Shortcuts worth knowing")).toBeTruthy();
    expect(getByText("Ctrl+K")).toBeTruthy();
    expect(getByText("F9")).toBeTruthy();
  });
});
